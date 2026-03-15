// ==============================================
// 严格遵循SillyTavern官方模板的导入规范
// 仅导入模板指定的函数，无额外非法导入
// ==============================================
import {
  extension_settings,
  getContext,
  loadExtensionSettings,
} from "../../../extensions.js";

import { saveSettingsDebounced } from "../../../../script.js";

// ==============================================
// 严格和官方模板一致的变量定义
// extensionName必须和插件文件夹名称完全一致
// ==============================================
const extensionName = "Continuation_machine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// 默认设置 完全匹配模板结构
const defaultSettings = {
  syncStContent: true,
  inheritStParams: true,
  currentFunction: "continuation",
  currentMode: "v_mode",
  currentStyle: "标准",
  currentLength: "200",
  customPrompt: "",
  savedStory: {
    title: "",
    chapter: "",
    content: "",
  },
};

// 全局状态变量
let currentGeneratedResults = [];
let currentInsertMode = false;
let isGenerating = false;
let syncDebounceTimer = null;

// ==============================================
// 严格和官方模板一致的设置加载函数
// 结构、写法完全对齐模板，无兼容性问题
// ==============================================
async function loadSettings() {
  // 初始化设置对象 完全和模板一致
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  const settings = extension_settings[extensionName];

  // 同步设置到UI 完全和模板的prop/trigger写法一致
  $("#sync_st_content")
    .prop("checked", settings.syncStContent)
    .trigger("input");
  
  $("#inherit_st_params")
    .prop("checked", settings.inheritStParams)
    .trigger("input");

  // 同步编辑器设置
  $(`#${settings.currentMode}`).prop("checked", true);
  $("#xiaomeng_style_select").val(settings.currentStyle);
  $("#xiaomeng_length_select").val(settings.currentLength);
  $("#xiaomeng_custom_prompt").val(settings.customPrompt);
  updateFunctionButtonText(settings.currentFunction);

  // 恢复已保存的故事内容
  if (settings.savedStory) {
    $("#xiaomeng_editor_title").val(settings.savedStory.title || "");
    $("#xiaomeng_editor_chapter").val(settings.savedStory.chapter || "");
    $("#xiaomeng_editor_textarea").val(settings.savedStory.content || "");
  }
}

// ==============================================
// 彩云小梦核心功能逻辑
// 1:1还原官网功能，AI调用完全使用ST原生window.generateCompletion
// ==============================================
// 更新功能按钮显示文本
function updateFunctionButtonText(functionType) {
  const functionNameMap = {
    continuation: "续写",
    expand: "扩写",
    shorten: "缩写",
    rewrite: "改写",
    custom: "定向续写",
  };
  $("#function_toggle_btn span").text(functionNameMap[functionType] || "续写");
}

// 打开/关闭编辑器
function openXiaomengEditor() {
  $("#xiaomeng_full_editor").addClass("show");
  const settings = extension_settings[extensionName];
  
  // 同步ST输入框内容
  if (settings.syncStContent) {
    const stText = $("#send_textarea").val() || "";
    if (stText) {
      $("#xiaomeng_editor_textarea").val(stText);
    }
  }
  
  $("#xiaomeng_editor_textarea").focus();
}

function closeXiaomengEditor() {
  $("#xiaomeng_full_editor").removeClass("show");
  const settings = extension_settings[extensionName];
  
  // 同步内容回ST输入框
  if (settings.syncStContent) {
    const editorText = $("#xiaomeng_editor_textarea").val() || "";
    $("#send_textarea").val(editorText).trigger("input");
  }
  
  // 保存故事内容
  saveCurrentStory();
}

// 保存当前故事内容
function saveCurrentStory() {
  extension_settings[extensionName].savedStory = {
    title: $("#xiaomeng_editor_title").val() || "",
    chapter: $("#xiaomeng_editor_chapter").val() || "",
    content: $("#xiaomeng_editor_textarea").val() || "",
  };
  saveSettingsDebounced();
}

// 内容双向同步（编辑器与ST输入框）
function syncContent(direction = "editor-to-st") {
  const settings = extension_settings[extensionName];
  if (!settings.syncStContent) return;

  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    if (direction === "editor-to-st") {
      const editorText = $("#xiaomeng_editor_textarea").val() || "";
      $("#send_textarea").val(editorText).trigger("input");
    } else {
      const stText = $("#send_textarea").val() || "";
      $("#xiaomeng_editor_textarea").val(stText);
    }
    saveCurrentStory();
  }, 300);
}

// 获取编辑器内容与选中文本
function getEditorContent() {
  const textarea = $("#xiaomeng_editor_textarea")[0];
  if (!textarea) return { fullText: "", selectedText: "", start: 0, end: 0 };
  return {
    fullText: textarea.value || "",
    selectedText: textarea.value.substring(textarea.selectionStart, textarea.selectionEnd) || "",
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  };
}

// 插入内容到编辑器 1:1还原官网逻辑
function insertContentToEditor(content, isReplaceSelected = false) {
  const textarea = $("#xiaomeng_editor_textarea")[0];
  if (!textarea) return;
  const { fullText, start, end } = getEditorContent();
  textarea.focus();

  // 替换选中内容/追加到文末（和官网完全一致）
  if (isReplaceSelected && start !== end) {
    textarea.value = fullText.substring(0, start) + content + fullText.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + content.length;
  } else {
    textarea.value = fullText + content;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  // 同步内容与保存
  syncContent("editor-to-st");
  toastr.success("内容已插入编辑器", "操作成功");
}

// 构建Prompt与生成参数 1:1还原彩云小梦的生成逻辑
function buildGenerateConfig() {
  const settings = extension_settings[extensionName];
  const { fullText, selectedText } = getEditorContent();
  const targetLength = Number($("#xiaomeng_length_select").val());
  const style = $("#xiaomeng_style_select").val();
  const mode = $("input[name='editor_mode']:checked").val();
  const functionType = settings.currentFunction;
  const customPrompt = $("#xiaomeng_custom_prompt").val().trim();

  // V/O模式参数 完全还原官网逻辑
  const baseParams = mode === "v_mode" 
    ? { temperature: 0.7, top_p: 0.85, repetition_penalty: 1.1 }
    : { temperature: 1.0, top_p: 0.95, repetition_penalty: 1.05 };

  // 继承ST全局参数（用户开启时）
  if (settings.inheritStParams) {
    const stContext = getContext();
    Object.assign(baseParams, {
      temperature: stContext.state.temperature,
      top_p: stContext.state.top_p,
      repetition_penalty: stContext.state.repetition_penalty,
      top_k: stContext.state.top_k,
      typical_p: stContext.state.typical_p,
    });
  }

  // 按功能类型构建Prompt 1:1还原官网逻辑
  let prompt = "";
  let isReplaceSelected = false;

  switch (functionType) {
    case "continuation":
      prompt = `你是专业的网络小说续写助手，严格遵循以下要求创作：
1. 基于用户提供的小说原文，**严格接在原文最后一句的末尾无缝续写**，绝对不要重复原文内容，只输出续写的正文，不要任何标题、解释、说明、前缀
2. 续写风格：【${style}】，严格贴合原文的人物设定、故事走向、叙事节奏、语言风格，情节连贯、逻辑自洽
3. 续写字数：严格控制在${targetLength}字左右，误差不超过10%
4. 只输出续写的正文内容，不要添加任何额外内容

小说原文：
${fullText}`;
      isReplaceSelected = false;
      break;

    case "expand":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要扩写的文本内容", "提示");
        return null;
      }
      prompt = `你是专业的小说扩写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，进行细节扩写，丰富人物的动作、表情、心理活动、场景描写、对话细节，让内容更生动饱满
2. 扩写风格：【${style}】，严格贴合原文的人物设定、故事背景、语言风格，不改变原文核心情节与意思
3. 扩写后字数：严格控制在${targetLength}字左右，误差不超过10%
4. 只输出扩写后的完整文本，不要任何解释、说明、前缀

要扩写的原文内容：
${selectedText}

上下文参考：
${fullText}`;
      isReplaceSelected = true;
      break;

    case "shorten":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要缩写的文本内容", "提示");
        return null;
      }
      prompt = `你是专业的文本缩写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，进行精简缩写，保留核心情节、关键信息、对话核心，去除冗余修饰
2. 缩写后内容逻辑连贯、语句通顺，贴合原文语言风格
3. 缩写后字数：严格控制在${targetLength}字左右，误差不超过10%
4. 只输出缩写后的完整文本，不要任何解释、说明、前缀

要缩写的原文内容：
${selectedText}`;
      isReplaceSelected = true;
      break;

    case "rewrite":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要改写的文本内容", "提示");
        return null;
      }
      prompt = `你是专业的小说改写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，用【${style}】的风格进行重写，不改变原文核心情节与关键信息，仅优化表达方式、叙事视角、描写风格
2. 改写后内容逻辑连贯、语句通顺，符合所选风格的特点
3. 改写后字数：严格控制在${targetLength}字左右，误差不超过10%
4. 只输出改写后的完整文本，不要任何解释、说明、前缀

要改写的原文内容：
${selectedText}

上下文参考：
${fullText}`;
      isReplaceSelected = true;
      break;

    case "custom":
      if (!customPrompt) {
        toastr.warning("请先输入自定义续写指令", "提示");
        return null;
      }
      prompt = `你是专业的小说创作助手，严格遵循用户的自定义指令创作：
1. 用户自定义指令：${customPrompt}
2. 基于用户提供的小说原文创作，严格贴合原文的人物设定、故事走向、语言风格，逻辑连贯自然
3. 创作风格：【${style}】，字数严格控制在${targetLength}字左右，误差不超过10%
4. 只输出符合要求的正文内容，不要任何解释、说明、前缀

小说原文：
${fullText}`;
      isReplaceSelected = false;
      break;

    default:
      prompt = "";
  }

  // 额外补充自定义指令
  if (functionType !== "custom" && customPrompt) {
    prompt += `\n额外要求：${customPrompt}`;
  }

  return {
    prompt,
    generateParams: {
      ...baseParams,
      max_new_tokens: Math.ceil(targetLength * 2),
      stop: ["\n\n\n", "###", "原文：", "小说原文："],
    },
    isReplaceSelected,
  };
}

// 调用SillyTavern原生父级API生成内容 完全不变
async function generateSingleContent(prompt, generateParams) {
  try {
    // 核心：完全使用ST原生暴露的generateCompletion函数，无任何修改
    const rawResult = await window.generateCompletion(prompt, generateParams);
    // 清理结果，和官网一致
    return rawResult.trim().replace(/\n{3,}/g, "\n\n").replace(/^["']|["']$/g, "");
  } catch (error) {
    console.error("ST原生API调用失败:", error);
    toastr.error(`生成失败: ${error.message || "请检查ST API连接状态"}`, "错误");
    return null;
  }
}

// 生成多分支内容 1:1还原官网3条不同走向的逻辑
async function generateMultiBranchContent() {
  if (isGenerating) return;
  const generateConfig = buildGenerateConfig();
  if (!generateConfig) return;

  const { prompt, generateParams, isReplaceSelected } = generateConfig;
  isGenerating = true;

  // 更新UI状态 和官网一致
  $("#action_ai_continue").prop("disabled", true).text("生成中...");
  $("#refresh_results_btn").prop("disabled", true);
  $("#results_cards_container").html(`<div class="empty-result-tip">正在生成多分支内容，请稍候...</div>`);

  try {
    // 并行生成3条差异化内容 和官网完全一致
    const generateTasks = [
      generateSingleContent(prompt, { ...generateParams, temperature: Math.max(0.5, generateParams.temperature - 0.2) }),
      generateSingleContent(prompt, { ...generateParams }),
      generateSingleContent(prompt, { ...generateParams, temperature: Math.min(1.5, generateParams.temperature + 0.2) }),
    ];

    const results = await Promise.all(generateTasks);
    // 过滤失败结果
    currentGeneratedResults = results.filter(item => item !== null && item.trim() !== "");
    currentInsertMode = isReplaceSelected;

    if (currentGeneratedResults.length === 0) {
      $("#results_cards_container").html(`<div class="empty-result-tip">生成失败，请检查API连接后重试</div>`);
      return;
    }

    // 渲染结果卡片 1:1还原官网
    renderResultCards();
    toastr.success(`成功生成${currentGeneratedResults.length}条内容`, "生成完成");
  } catch (error) {
    console.error("批量生成失败:", error);
    $("#results_cards_container").html(`<div class="empty-result-tip">生成失败，请重试</div>`);
  } finally {
    // 恢复UI状态
    isGenerating = false;
    $("#action_ai_continue").prop("disabled", false).text("Ai 继续");
    $("#refresh_results_btn").prop("disabled", currentGeneratedResults.length === 0);
  }
}

// 渲染结果卡片 1:1还原官网横向卡片、New标签、使用按钮
function renderResultCards() {
  const container = $("#results_cards_container");
  container.empty();

  currentGeneratedResults.forEach((content, index) => {
    // 预览内容取前60字，和官网完全一致
    const previewContent = content.length > 60 ? content.substring(0, 60) + "..." : content;
    const card = $(`
      <div class="result-card">
        <span class="new-tag">New</span>
        <div class="card-preview-text">${previewContent}</div>
        <button class="card-use-btn" data-index="${index}">使用</button>
      </div>
    `);
    container.append(card);
  });

  // 绑定使用按钮事件
  $(".card-use-btn").on("click", (event) => {
    const index = $(event.target).data("index");
    const selectedContent = currentGeneratedResults[index];
    if (selectedContent) {
      insertContentToEditor(selectedContent, currentInsertMode);
    }
  });
}

// ==============================================
// 严格和官方模板一致的jQuery入口函数
// 执行顺序、写法完全对齐模板，确保ST正常加载
// ==============================================
jQuery(async () => {
  // 第一步：加载HTML文件 完全和模板一致
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);

  // 第二步：append到ST固定容器#extensions_settings 完全和模板一致
  $("#extensions_settings").append(settingsHtml);

  // 第三步：绑定事件 完全和模板一致的写法
  // 模板原有设置项事件
  $("#open_xiaomeng_editor").on("click", openXiaomengEditor);
  $("#sync_st_content").on("input", (event) => {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].syncStContent = value;
    saveSettingsDebounced();
  });
  $("#inherit_st_params").on("input", (event) => {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].inheritStParams = value;
    saveSettingsDebounced();
  });

  // 编辑器核心事件
  $("#close_editor_btn").on("click", closeXiaomengEditor);
  $("input[name='editor_mode']").on("change", (event) => {
    extension_settings[extensionName].currentMode = $(event.target).val();
    saveSettingsDebounced();
  });

  // 功能抽屉事件
  $("#function_toggle_btn").on("click", () => $("#function_dropdown").toggleClass("show"));
  $(document).on("click", (e) => {
    if (!$(e.target).closest("#function_drawer_wrapper").length) {
      $("#function_dropdown").removeClass("show");
    }
  });
  $(".dropdown-item").on("click", (e) => {
    const functionType = $(e.currentTarget).data("function");
    extension_settings[extensionName].currentFunction = functionType;
    saveSettingsDebounced();
    updateFunctionButtonText(functionType);
    $("#function_dropdown").removeClass("show");
  });

  // 生成相关事件
  $("#action_ai_continue").on("click", generateMultiBranchContent);
  $("#refresh_results_btn").on("click", generateMultiBranchContent);
  $("#xiaomeng_style_select").on("change", (event) => {
    extension_settings[extensionName].currentStyle = $(event.target).val();
    saveSettingsDebounced();
  });
  $("#xiaomeng_length_select").on("change", (event) => {
    extension_settings[extensionName].currentLength = $(event.target).val();
    saveSettingsDebounced();
  });
  $("#xiaomeng_custom_prompt").on("input", (event) => {
    extension_settings[extensionName].customPrompt = $(event.target).val();
    saveSettingsDebounced();
  });

  // 编辑操作栏事件
  $("#action_undo").on("click", () => document.execCommand("undo", false, null));
  $("#action_modify").on("click", () => {
    // 快速选中当前行 和官网一致
    const textarea = $("#xiaomeng_editor_textarea")[0];
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1;
    const lineEnd = text.indexOf("\n", cursorPos);
    textarea.selectionStart = lineStart;
    textarea.selectionEnd = lineEnd === -1 ? text.length : lineEnd;
    textarea.focus();
  });
  $("#action_save").on("click", () => {
    saveCurrentStory();
    toastr.success("故事内容已保存", "保存成功");
  });

  // 内容同步事件
  $("#xiaomeng_editor_textarea").on("input", () => syncContent("editor-to-st"));
  $("#send_textarea").on("input", () => syncContent("st-to-editor"));

  // ESC键关闭编辑器
  $(document).on("keydown", (e) => {
    if (e.key === "Escape" && $("#xiaomeng_full_editor").hasClass("show")) {
      closeXiaomengEditor();
    }
  });

  // 第四步：加载设置 完全和模板一致，最后执行
  loadSettings();
});
