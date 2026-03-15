// 彩云小梦小说续写插件 - 核心逻辑
// 完全兼容SillyTavern所有稳定版本，自动复用ST原生API
import {
  extension_settings,
  getContext,
  loadExtensionSettings,
} from "../../../extensions.js";

import {
  saveSettingsDebounced,
  generateCompletion,
} from "../../../../script.js";

// 【关键】必须和你的扩展文件夹名称完全一致！！！
const extensionName = "Continuation_machine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// 默认设置
const defaultSettings = {
  syncStContent: true,
  inheritStParams: true,
  autoSaveContent: true,
  mode: "v_mode",
  functionType: "continuation",
  customPrompt: "",
  style: "标准",
  length: "200",
  savedContent: {
    title: "",
    chapter: "",
    text: "",
  },
};

// 全局状态
let currentResults = [];
let currentInsertMode = false;
let isGenerating = false;
let syncTimer = null;

// ==============================================
// 初始化：必须先加载设置，再渲染UI，确保扩展能被ST识别
// ==============================================
async function initExtension() {
  try {
    // 1. 加载HTML模板到ST扩展面板
    const html = await $.get(`${extensionFolderPath}/example.html`);
    $("#extensions_settings").append(html);

    // 2. 初始化设置
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
      Object.assign(extension_settings[extensionName], defaultSettings);
    }
    const settings = extension_settings[extensionName];

    // 3. 同步设置到UI
    $("#sync_st_content").prop("checked", settings.syncStContent);
    $("#inherit_st_params").prop("checked", settings.inheritStParams);
    $("#auto_save_content").prop("checked", settings.autoSaveContent);
    $(`#${settings.mode}`).prop("checked", true);
    $("#style_select").val(settings.style);
    $("#length_select").val(settings.length);
    $("#custom_prompt").val(settings.customPrompt);
    $("#function_name").text({
      continuation: "续写",
      expand: "扩写",
      shorten: "缩写",
      rewrite: "改写",
      custom: "定向续写",
    }[settings.functionType] || "续写");

    // 4. 恢复保存的内容
    if (settings.savedContent) {
      $("#editor_title").val(settings.savedContent.title || "");
      $("#editor_chapter").val(settings.savedContent.chapter || "");
      $("#editor_textarea").val(settings.savedContent.text || "");
    }

    // 5. 绑定所有事件
    bindEvents();

    console.log(`[${extensionName}] 插件加载成功`);
  } catch (error) {
    console.error(`[${extensionName}] 插件加载失败:`, error);
    toastr.error(`续写插件加载失败: ${error.message}`, "错误");
  }
}

// ==============================================
// 事件绑定
// ==============================================
function bindEvents() {
  const settings = extension_settings[extensionName];

  // 编辑器打开/关闭
  $("#open_editor_btn").on("click", openEditor);
  $("#close_editor_btn").on("click", closeEditor);

  // 设置变更事件
  $("#sync_st_content").on("change", (e) => {
    settings.syncStContent = Boolean($(e.target).prop("checked"));
    saveSettingsDebounced();
  });
  $("#inherit_st_params").on("change", (e) => {
    settings.inheritStParams = Boolean($(e.target).prop("checked"));
    saveSettingsDebounced();
  });
  $("#auto_save_content").on("change", (e) => {
    settings.autoSaveContent = Boolean($(e.target).prop("checked"));
    saveSettingsDebounced();
  });

  // 模式切换
  $("input[name='editor_mode']").on("change", (e) => {
    settings.mode = $(e.target).val();
    saveSettingsDebounced();
  });

  // 功能抽屉
  $("#function_toggle").on("click", () => {
    $("#function_drawer").toggleClass("show");
  });
  $(document).on("click", (e) => {
    if (!$(e.target).closest(".footer-function-drawer").length) {
      $("#function_drawer").removeClass("show");
    }
  });
  $(".drawer-item").on("click", (e) => {
    const funcType = $(e.currentTarget).data("func");
    settings.functionType = funcType;
    $("#function_name").text($(e.currentTarget).find("span").text());
    $("#function_drawer").removeClass("show");
    saveSettingsDebounced();
  });

  // 基础设置变更
  $("#custom_prompt").on("input", (e) => {
    settings.customPrompt = $(e.target).val();
    saveSettingsDebounced();
  });
  $("#style_select").on("change", (e) => {
    settings.style = $(e.target).val();
    saveSettingsDebounced();
  });
  $("#length_select").on("change", (e) => {
    settings.length = $(e.target).val();
    saveSettingsDebounced();
  });

  // 生成按钮
  $("#action_ai_continue").on("click", generateContent);
  $("#refresh_btn").on("click", generateContent);

  // 内容同步
  $("#editor_textarea").on("input", () => {
    syncContent("editor-to-st");
    autoSaveContent();
  });
  $("#send_textarea").on("input", () => {
    syncContent("st-to-editor");
  });

  // 编辑操作栏
  $("#action_undo").on("click", () => document.execCommand("undo", false, null));
  $("#action_modify").on("click", selectCurrentLine);
  $("#action_save").on("click", () => {
    saveCurrentContent();
    toastr.success("内容已保存", "成功");
  });

  // ESC关闭编辑器
  $(document).on("keydown", (e) => {
    if (e.key === "Escape" && $("#cy_xiaomeng_editor").hasClass("show")) {
      closeEditor();
    }
  });
}

// ==============================================
// 核心功能函数
// ==============================================
// 打开编辑器
function openEditor() {
  $("#cy_xiaomeng_editor").addClass("show");
  const settings = extension_settings[extensionName];
  if (settings.syncStContent) {
    const stText = $("#send_textarea").val() || "";
    if (stText && stText !== $("#editor_textarea").val()) {
      $("#editor_textarea").val(stText);
    }
  }
  $("#editor_textarea").focus();
}

// 关闭编辑器
function closeEditor() {
  $("#cy_xiaomeng_editor").removeClass("show");
  const settings = extension_settings[extensionName];
  if (settings.syncStContent) {
    const editorText = $("#editor_textarea").val() || "";
    $("#send_textarea").val(editorText).trigger("input");
  }
  saveCurrentContent();
}

// 内容双向同步
function syncContent(direction) {
  const settings = extension_settings[extensionName];
  if (!settings.syncStContent) return;

  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (direction === "editor-to-st") {
      const text = $("#editor_textarea").val() || "";
      $("#send_textarea").val(text).trigger("input");
    } else if (direction === "st-to-editor") {
      const text = $("#send_textarea").val() || "";
      $("#editor_textarea").val(text);
    }
  }, 300);
}

// 自动保存内容
function autoSaveContent() {
  const settings = extension_settings[extensionName];
  if (!settings.autoSaveContent) return;
  saveCurrentContent();
}

// 保存当前内容
function saveCurrentContent() {
  const settings = extension_settings[extensionName];
  settings.savedContent = {
    title: $("#editor_title").val() || "",
    chapter: $("#editor_chapter").val() || "",
    text: $("#editor_textarea").val() || "",
  };
  saveSettingsDebounced();
}

// 选中当前行
function selectCurrentLine() {
  const textarea = $("#editor_textarea")[0];
  const text = textarea.value;
  const cursorPos = textarea.selectionStart;
  const lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1;
  const lineEnd = text.indexOf("\n", cursorPos);
  textarea.selectionStart = lineStart;
  textarea.selectionEnd = lineEnd === -1 ? text.length : lineEnd;
  textarea.focus();
}

// 获取编辑器内容
function getEditorContent() {
  const textarea = $("#editor_textarea")[0];
  return {
    fullText: textarea.value || "",
    selectedText: textarea.value.substring(textarea.selectionStart, textarea.selectionEnd) || "",
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  };
}

// 插入内容到编辑器
function insertContent(content, isReplace = false) {
  const textarea = $("#editor_textarea")[0];
  const { fullText, start, end } = getEditorContent();
  textarea.focus();

  if (isReplace && start !== end) {
    textarea.value = fullText.substring(0, start) + content + fullText.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + content.length;
  } else {
    textarea.value = fullText + content;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  syncContent("editor-to-st");
  saveCurrentContent();
  toastr.success("内容已插入编辑器", "成功");
}

// 构建生成Prompt
function buildPrompt() {
  const settings = extension_settings[extensionName];
  const { fullText, selectedText } = getEditorContent();
  const targetLength = Number(settings.length);

  // 模式参数
  const modeParams = {
    v_mode: { temperature: 0.7, top_p: 0.85, repetition_penalty: 1.1 },
    o_mode: { temperature: 1.0, top_p: 0.95, repetition_penalty: 1.05 },
  };
  let generateParams = modeParams[settings.mode];

  // 继承ST全局参数
  if (settings.inheritStParams) {
    const ctx = getContext();
    generateParams = {
      ...generateParams,
      temperature: ctx.state.temperature,
      top_p: ctx.state.top_p,
      repetition_penalty: ctx.state.repetition_penalty,
    };
  }

  // 生成参数
  generateParams.max_new_tokens = Math.ceil(targetLength * 2);
  generateParams.stop = ["\n\n\n", "###", "原文："];

  // 构建Prompt
  let prompt = "";
  let isReplace = false;

  switch (settings.functionType) {
    case "continuation":
      prompt = `你是专业的小说续写助手，严格遵循要求：
1. 接在原文末尾续写，和原文无缝衔接，不重复原文，只输出续写正文，不要任何额外内容
2. 续写风格：【${settings.style}】，贴合原文的人物、情节、文风，逻辑连贯
3. 字数：${targetLength}字左右，误差不超过10%

原文：
${fullText}`;
      isReplace = false;
      break;

    case "expand":
      if (!selectedText) {
        toastr.warning("请先选中要扩写的文本", "提示");
        return null;
      }
      prompt = `你是专业的小说扩写助手，严格遵循要求：
1. 扩写选中的文本，丰富动作、表情、心理、场景细节，不改变原文核心情节
2. 扩写风格：【${settings.style}】，贴合原文的人物和文风
3. 字数：${targetLength}字左右，误差不超过10%
4. 只输出扩写后的完整文本，不要任何额外内容

要扩写的内容：
${selectedText}

上下文：
${fullText}`;
      isReplace = true;
      break;

    case "shorten":
      if (!selectedText) {
        toastr.warning("请先选中要缩写的文本", "提示");
        return null;
      }
      prompt = `你是专业的文本缩写助手，严格遵循要求：
1. 精简缩写选中的文本，保留核心情节和关键信息，去除冗余内容
2. 缩写后逻辑连贯，贴合原文风格，字数控制在${targetLength}字左右
3. 只输出缩写后的完整文本，不要任何额外内容

要缩写的内容：
${selectedText}`;
      isReplace = true;
      break;

    case "rewrite":
      if (!selectedText) {
        toastr.warning("请先选中要改写的文本", "提示");
        return null;
      }
      prompt = `你是专业的小说改写助手，严格遵循要求：
1. 用【${settings.style}】的风格重写选中的文本，不改变原文核心情节
2. 改写后逻辑连贯，字数控制在${targetLength}字左右
3. 只输出改写后的完整文本，不要任何额外内容

要改写的内容：
${selectedText}

上下文：
${fullText}`;
      isReplace = true;
      break;

    case "custom":
      if (!settings.customPrompt.trim()) {
        toastr.warning("请先输入自定义指令", "提示");
        return null;
      }
      prompt = `你是专业的小说创作助手，严格遵循要求：
1. 用户指令：${settings.customPrompt}
2. 基于原文创作，贴合原文的人物、情节、文风，风格：【${settings.style}】
3. 字数：${targetLength}字左右，只输出正文，不要任何额外内容

原文：
${fullText}`;
      isReplace = false;
      break;

    default:
      prompt = "";
  }

  // 额外自定义指令
  if (settings.functionType !== "custom" && settings.customPrompt.trim()) {
    prompt += `\n额外要求：${settings.customPrompt}`;
  }

  return { prompt, generateParams, isReplace };
}

// 调用ST原生API生成内容
async function generateContent() {
  if (isGenerating) return;
  const config = buildPrompt();
  if (!config) return;

  const { prompt, generateParams, isReplace } = config;
  isGenerating = true;

  // 更新UI状态
  $("#action_ai_continue").prop("disabled", true).val("生成中...");
  $("#refresh_btn").prop("disabled", true);
  $("#results_container").html(`<div class="empty-tip">正在生成内容，请稍候...</div>`);

  try {
    // 并行生成3条差异化内容（复刻彩云小梦多分支）
    const tasks = [
      generateCompletion(prompt, { ...generateParams, temperature: Math.max(0.5, generateParams.temperature - 0.2) }),
      generateCompletion(prompt, { ...generateParams }),
      generateCompletion(prompt, { ...generateParams, temperature: Math.min(1.5, generateParams.temperature + 0.2) }),
    ];

    const results = await Promise.all(tasks);
    currentResults = results.filter(item => item && item.trim() !== "");
    currentInsertMode = isReplace;

    if (currentResults.length === 0) {
      $("#results_container").html(`<div class="empty-tip">生成失败，请检查ST API连接</div>`);
      return;
    }

    // 渲染结果卡片
    renderResults();
    toastr.success(`成功生成${currentResults.length}条内容`, "生成完成");
  } catch (error) {
    console.error("生成失败:", error);
    $("#results_container").html(`<div class="empty-tip">生成失败: ${error.message}</div>`);
    toastr.error(`生成失败: ${error.message}`, "错误");
  } finally {
    isGenerating = false;
    $("#action_ai_continue").prop("disabled", false).val("AI继续");
    $("#refresh_btn").prop("disabled", currentResults.length === 0);
  }
}

// 渲染结果卡片
function renderResults() {
  const container = $("#results_container");
  container.empty();

  currentResults.forEach((content, index) => {
    const preview = content.length > 80 ? content.substring(0, 80) + "..." : content;
    const card = $(`
      <div class="result-card">
        <div class="card-preview">${preview}</div>
        <input class="menu_button use-btn" type="button" value="使用" data-index="${index}" />
      </div>
    `);
    container.append(card);
  });

  // 绑定使用按钮
  $(".use-btn").on("click", (e) => {
    const index = $(e.target).data("index");
    const content = currentResults[index];
    if (content) {
      insertContent(content.trim(), currentInsertMode);
    }
  });
}

// 插件入口（jQuery DOM加载完成后执行，确保ST环境已就绪）
jQuery(async () => {
  await initExtension();
});
