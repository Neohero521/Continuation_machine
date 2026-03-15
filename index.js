// 彩云小梦网页版复刻编辑器 核心逻辑
import {
  extension_settings,
  getContext,
  loadExtensionSettings,
} from "../../../extensions.js";

import { saveSettingsDebounced } from "../../../../script.js";

// 插件基础配置（名称需和你的仓库名完全一致）
const extensionName = "Continuation_machine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// 默认设置
const defaultSettings = {
  syncContent: true,
  mode: "v_mode",
  functionType: "continuation",
  customPrompt: "",
  style: "标准",
  length: "200",
};

// 全局变量
let currentFullResults = [];
let currentInsertMode = false;
let syncTimer = null;

// 加载并初始化设置
async function loadSettings() {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  const settings = extension_settings[extensionName];
  // 同步设置到UI
  $("#sync_editor_content").prop("checked", settings.syncContent);
  $(`#${settings.mode}`).prop("checked", true);
  $("#style_select").val(settings.style);
  $("#custom_prompt_input").val(settings.customPrompt);

  // 更新功能按钮显示文本
  updateFunctionButtonText(settings.functionType);
}

// 更新功能按钮文本
function updateFunctionButtonText(functionType) {
  const functionNameMap = {
    continuation: "续写",
    expand: "扩写",
    shorten: "缩写",
    rewrite: "改写",
    custom: "定向续写",
  };
  $("#function_toggle span").text(functionNameMap[functionType] || "续写");
}

// 打开全屏编辑器
function openEditor() {
  $("#cy_xiaomeng_editor").addClass("show");
  // 同步ST输入框内容到编辑器
  if (extension_settings[extensionName].syncContent) {
    const stText = $("#send_textarea").val() || "";
    $("#editor_textarea").val(stText);
  }
  $("#editor_textarea").focus();
}

// 关闭全屏编辑器
function closeEditor() {
  $("#cy_xiaomeng_editor").removeClass("show");
  // 同步编辑器内容回ST输入框
  if (extension_settings[extensionName].syncContent) {
    const editorText = $("#editor_textarea").val() || "";
    $("#send_textarea").val(editorText).trigger("input");
  }
}

// 编辑器与ST输入框双向内容同步
function syncContent(direction = "editor-to-st") {
  if (!extension_settings[extensionName].syncContent) return;

  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (direction === "editor-to-st") {
      const editorText = $("#editor_textarea").val() || "";
      $("#send_textarea").val(editorText).trigger("input");
    } else if (direction === "st-to-editor") {
      const stText = $("#send_textarea").val() || "";
      $("#editor_textarea").val(stText);
    }
  }, 300);
}

// 获取编辑器内容与选中文本
function getEditorContent() {
  const textarea = $("#editor_textarea")[0];
  if (!textarea) return { fullText: "", selectedText: "", start: 0, end: 0 };

  const fullText = textarea.value || "";
  const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd) || "";
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  return { fullText, selectedText, start, end };
}

// 插入内容到编辑器
function insertContentToEditor(content, isReplaceSelected = false) {
  const textarea = $("#editor_textarea")[0];
  if (!textarea) return;

  const { fullText, start, end } = getEditorContent();
  textarea.focus();

  if (isReplaceSelected && start !== end) {
    // 替换选中内容（扩写/缩写/改写用）
    textarea.value = fullText.substring(0, start) + content + fullText.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + content.length;
  } else {
    // 追加到文末（续写用，和彩云小梦逻辑完全一致）
    textarea.value = fullText + content;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  // 触发内容同步
  syncContent("editor-to-st");
  toastr.success("内容已插入编辑器", "操作成功");
}

// 构建生成Prompt
function buildPrompt() {
  const settings = extension_settings[extensionName];
  const { fullText, selectedText } = getEditorContent();
  const targetLength = Number(settings.length);

  // 根据V/O模式设置温度，V模式严谨保守，O模式开放脑洞
  const baseTemperature = settings.mode === "v_mode" ? 0.7 : 1.0;
  let prompt = "";
  let isReplaceSelected = false;

  switch (settings.functionType) {
    // 续写功能
    case "continuation":
      prompt = `你是专业的网络小说续写助手，严格遵循以下要求创作：
1. 基于用户提供的小说原文，严格接在原文最后一句的末尾续写，和原文无缝衔接，绝对不要重复原文内容，只输出续写的正文，不要任何标题、解释、说明、前缀
2. 续写风格为【${settings.style}】，严格贴合原文的人物设定、故事走向、叙事节奏和语言风格，情节连贯自然，符合逻辑
3. 续写字数严格控制在${targetLength}字左右，误差不超过20字
4. 只输出续写的正文，不要添加任何额外内容

原文内容：
${fullText}`;
      isReplaceSelected = false;
      break;

    // 扩写功能
    case "expand":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要扩写的文本内容", "选中内容为空");
        return null;
      }
      prompt = `你是专业的小说扩写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，进行细节扩写，丰富人物的动作、表情、心理活动、场景描写、对话细节，让内容更生动饱满
2. 扩写风格为【${settings.style}】，严格贴合原文的人物设定、故事背景和语言风格，不要改变原文的核心情节和意思
3. 扩写后的字数控制在${targetLength}字左右，误差不超过20字
4. 只输出扩写后的完整文本，不要任何解释、说明、前缀

要扩写的原文内容：
${selectedText}

上下文参考：
${fullText}`;
      isReplaceSelected = true;
      break;

    // 缩写功能
    case "shorten":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要缩写的文本内容", "选中内容为空");
        return null;
      }
      prompt = `你是专业的文本缩写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，进行精简缩写，保留核心情节、关键信息和人物对话的核心意思，去除冗余的修饰和描写
2. 缩写后的内容要逻辑连贯，语句通顺，贴合原文的语言风格
3. 缩写后的字数严格控制在${targetLength}字左右，误差不超过20字
4. 只输出缩写后的完整文本，不要任何解释、说明、前缀

要缩写的原文内容：
${selectedText}`;
      isReplaceSelected = true;
      break;

    // 改写功能
    case "rewrite":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要改写的文本内容", "选中内容为空");
        return null;
      }
      prompt = `你是专业的小说改写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，用【${settings.style}】的风格进行重写，不改变原文的核心情节和关键信息，只改变表达方式、叙事视角、描写风格
2. 改写后的内容要逻辑连贯，语句通顺，符合所选风格的特点
3. 改写后的字数控制在${targetLength}字左右，误差不超过20字
4. 只输出改写后的完整文本，不要任何解释、说明、前缀

要改写的原文内容：
${selectedText}

上下文参考：
${fullText}`;
      isReplaceSelected = true;
      break;

    // 定向续写功能
    case "custom":
      if (!settings.customPrompt.trim()) {
        toastr.warning("请先输入自定义续写指令", "指令为空");
        return null;
      }
      prompt = `你是专业的小说创作助手，严格遵循用户的自定义指令和以下要求创作：
1. 用户自定义指令：${settings.customPrompt}
2. 基于用户提供的小说原文进行创作，严格贴合原文的人物设定、故事走向和语言风格，逻辑连贯自然
3. 创作风格为【${settings.style}】，字数严格控制在${targetLength}字左右，误差不超过20字
4. 只输出符合要求的正文内容，不要任何解释、说明、前缀

原文内容：
${fullText}`;
      isReplaceSelected = false;
      break;

    default:
      prompt = "";
  }

  // 额外补充自定义指令（所有功能都支持额外要求）
  if (settings.functionType !== "custom" && settings.customPrompt.trim()) {
    prompt += `\n额外要求：${settings.customPrompt}`;
  }

  return { prompt, baseTemperature, isReplaceSelected };
}

// 调用ST内置模型生成单条内容
async function generateSingleContent(prompt, temperature) {
  try {
    const targetLength = Number(extension_settings[extensionName].length);
    const generateParams = {
      temperature: temperature,
      max_new_tokens: Math.ceil(targetLength * 1.8),
      top_p: extension_settings[extensionName].mode === "v_mode" ? 0.85 : 0.95,
      repetition_penalty: 1.05,
      do_sample: true,
    };

    // 兼容SillyTavern所有已配置的模型
    const result = await window.generateCompletion(prompt, generateParams);
    // 清理生成结果，去除多余换行和空格
    return result.trim().replace(/\n{3,}/g, "\n\n");
  } catch (error) {
    console.error("内容生成失败:", error);
    toastr.error("模型调用失败，请检查你的模型配置和连接", "生成错误");
    return null;
  }
}

// 生成多分支内容（3条不同走向，和彩云小梦完全一致）
async function generateContent() {
  const promptConfig = buildPrompt();
  if (!promptConfig) return;

  const { prompt, baseTemperature, isReplaceSelected } = promptConfig;

  // 更新按钮状态，防止重复点击
  $("#action_ai_continue").prop("disabled", true).val("生成中...");
  $("#refresh_results_btn").prop("disabled", true);
  $("#results_cards").html(`<div class="empty-tip">正在生成多分支内容，请稍候...</div>`);

  try {
    // 并行生成3个不同温度的结果，实现差异化走向
    const generateTasks = [
      generateSingleContent(prompt, baseTemperature - 0.1),
      generateSingleContent(prompt, baseTemperature),
      generateSingleContent(prompt, baseTemperature + 0.1),
    ];

    const results = await Promise.all(generateTasks);
    currentFullResults = results.filter(item => item !== null && item.trim() !== "");
    currentInsertMode = isReplaceSelected;

    if (currentFullResults.length === 0) {
      $("#results_cards").html(`<div class="empty-tip">生成失败，请检查模型配置后重试</div>`);
      return;
    }

    // 渲染结果卡片
    renderResultCards();
    toastr.success(`成功生成${currentFullResults.length}条内容`, "生成完成");
  } catch (error) {
    console.error("批量生成失败:", error);
    $("#results_cards").html(`<div class="empty-tip">生成失败，请重试</div>`);
  } finally {
    // 恢复按钮状态
    $("#action_ai_continue").prop("disabled", false).val("AI继续");
    $("#refresh_results_btn").prop("disabled", currentFullResults.length === 0);
  }
}

// 渲染横向结果卡片
function renderResultCards() {
  const container = $("#results_cards");
  container.empty();

  currentFullResults.forEach((content, index) => {
    // 预览内容取前80字，超出用省略号，和原版完全一致
    const previewContent = content.length > 80 ? content.substring(0, 80) + "..." : content;
    const card = $(`
      <div class="cy-result-card">
        <div class="card-preview">${previewContent}</div>
        <button class="card-use-btn" data-index="${index}">使用</button>
      </div>
    `);
    container.append(card);
  });

  // 绑定使用按钮事件
  $(".card-use-btn").on("click", (event) => {
    const index = $(event.target).data("index");
    const selectedContent = currentFullResults[index];
    if (selectedContent) {
      insertContentToEditor(selectedContent, currentInsertMode);
    }
  });
}

// 插件加载入口
jQuery(async () => {
  // 加载UI模板
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
  $("#extensions_settings").append(settingsHtml);

  // 加载设置
  await loadSettings();

  // 绑定入口事件
  $("#open_editor_btn").on("click", openEditor);
  $("#close_editor_btn").on("click", closeEditor);

  // 同步设置事件
  $("#sync_editor_content").on("change", (event) => {
    extension_settings[extensionName].syncContent = Boolean($(event.target).prop("checked"));
    saveSettingsDebounced();
  });

  // 模式切换事件
  $("input[name='editor_mode']").on("change", (event) => {
    extension_settings[extensionName].mode = $(event.target).val();
    saveSettingsDebounced();
  });

  // 功能抽屉展开/收起
  $("#function_toggle").on("click", () => {
    $("#function_drawer_content").toggleClass("show");
  });

  // 点击页面其他区域关闭抽屉
  $(document).on("click", (event) => {
    if (!$(event.target).closest("#function_drawer_trigger").length) {
      $("#function_drawer_content").removeClass("show");
    }
  });

  // 功能项选择事件
  $(".drawer-item").on("click", (event) => {
    const functionType = $(event.currentTarget).data("function");
    extension_settings[extensionName].functionType = functionType;
    saveSettingsDebounced();
    updateFunctionButtonText(functionType);
    $("#function_drawer_content").removeClass("show");
  });

  // 自定义指令事件
  $("#custom_prompt_input").on("input", (event) => {
    extension_settings[extensionName].customPrompt = $(event.target).val();
    saveSettingsDebounced();
  });

  // 风格选择事件
  $("#style_select").on("change", (event) => {
    extension_settings[extensionName].style = $(event.target).val();
    saveSettingsDebounced();
  });

  // 生成按钮事件
  $("#action_ai_continue").on("click", generateContent);
  $("#refresh_results_btn").on("click", generateContent);

  // 内容双向同步
  $("#editor_textarea").on("input", () => syncContent("editor-to-st"));
  $("#send_textarea").on("input", () => syncContent("st-to-editor"));

  // 撤回按钮
  $("#action_undo").on("click", () => {
    document.execCommand("undo", false, null);
  });

  // 修改按钮（快速选中当前行）
  $("#action_modify").on("click", () => {
    const textarea = $("#editor_textarea")[0];
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1;
    const lineEnd = text.indexOf("\n", cursorPos);
    textarea.selectionStart = lineStart;
    textarea.selectionEnd = lineEnd === -1 ? text.length : lineEnd;
    textarea.focus();
  });

  // 保存按钮（同步到ST输入框）
  $("#action_save").on("click", () => {
    syncContent("editor-to-st");
    toastr.success("内容已同步保存到聊天输入框", "保存成功");
  });

  // ESC键关闭编辑器
  $(document).on("keydown", (event) => {
    if (event.key === "Escape" && $("#cy_xiaomeng_editor").hasClass("show")) {
      closeEditor();
    }
  });
});
