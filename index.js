// 严格保留官方模板的导入内容，不新增模板外的导入，避免兼容性问题
import {
  extension_settings,
  getContext,
  loadExtensionSettings,
} from "../../../extensions.js";

// 严格保留模板的导入，仅使用ST原生暴露的核心函数
import { saveSettingsDebounced } from "../../../../script.js";

// 严格和模板一致：extensionName必须和仓库/文件夹名称完全一致
const extensionName = "st-extension-example";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// 严格和模板一致：默认设置定义
const defaultSettings = {
  syncStContent: true,
  inheritStSettings: true,
  autoSaveStory: true,
  defaultLength: "200",
  defaultStyle: "标准",
  currentStory: {
    title: "",
    chapter: "",
    content: "",
  },
};

// 全局变量（仅在模板基础上新增，不修改模板核心结构）
let currentFullResults = [];
let currentInsertMode = false;
let syncDebounceTimer = null;
let isGenerating = false;

// 严格和模板一致：设置加载函数，结构完全对齐
async function loadSettings() {
  // 严格和模板一致：初始化设置对象
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  // 严格和模板一致：UI设置同步，和模板的prop/trigger写法完全对齐
  $("#sync_st_content")
    .prop("checked", extension_settings[extensionName].syncStContent)
    .trigger("input");
  
  $("#inherit_st_settings")
    .prop("checked", extension_settings[extensionName].inheritStSettings)
    .trigger("input");
  
  $("#auto_save_story")
    .prop("checked", extension_settings[extensionName].autoSaveStory)
    .trigger("input");
  
  $(`#length_${extension_settings[extensionName].defaultLength}`)
    .prop("checked", true)
    .trigger("input");
  
  $("#default_style")
    .val(extension_settings[extensionName].defaultStyle)
    .trigger("input");

  // 编辑器默认值同步
  $("#editor_length_select").val(extension_settings[extensionName].defaultLength);
  $("#editor_style_select").val(extension_settings[extensionName].defaultStyle);

  // 恢复故事内容
  if (extension_settings[extensionName].currentStory) {
    $("#editor_title").val(extension_settings[extensionName].currentStory.title || "");
    $("#editor_chapter").val(extension_settings[extensionName].currentStory.chapter || "");
    $("#editor_textarea").val(extension_settings[extensionName].currentStory.content || "");
  }
}

// ==============================================
// 以下为功能函数，不修改模板核心结构
// ==============================================
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

// 打开/关闭编辑器
function openEditor() {
  $("#cy_xiaomeng_editor").addClass("show");
  const settings = extension_settings[extensionName];
  if (settings.syncStContent) {
    const stText = $("#send_textarea").val() || "";
    if (stText) $("#editor_textarea").val(stText);
  }
  $("#editor_textarea").focus();
}

function closeEditor() {
  $("#cy_xiaomeng_editor").removeClass("show");
  const settings = extension_settings[extensionName];
  if (settings.syncStContent) {
    const editorText = $("#editor_textarea").val() || "";
    $("#send_textarea").val(editorText).trigger("input");
  }
  if (settings.autoSaveStory) saveCurrentStory();
}

// 保存故事内容
function saveCurrentStory() {
  extension_settings[extensionName].currentStory = {
    title: $("#editor_title").val() || "",
    chapter: $("#editor_chapter").val() || "",
    content: $("#editor_textarea").val() || "",
  };
  saveSettingsDebounced();
}

// 内容双向同步
function syncContent(direction = "editor-to-st") {
  const settings = extension_settings[extensionName];
  if (!settings.syncStContent) return;

  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    if (direction === "editor-to-st") {
      const editorText = $("#editor_textarea").val() || "";
      $("#send_textarea").val(editorText).trigger("input");
    } else {
      const stText = $("#send_textarea").val() || "";
      $("#editor_textarea").val(stText);
    }
    if (extension_settings[extensionName].autoSaveStory) saveCurrentStory();
  }, 300);
}

// 获取编辑器内容
function getEditorContent() {
  const textarea = $("#editor_textarea")[0];
  if (!textarea) return { fullText: "", selectedText: "", start: 0, end: 0 };
  return {
    fullText: textarea.value || "",
    selectedText: textarea.value.substring(textarea.selectionStart, textarea.selectionEnd) || "",
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  };
}

// 插入内容到编辑器
function insertContentToEditor(content, isReplaceSelected = false) {
  const textarea = $("#editor_textarea")[0];
  if (!textarea) return;
  const { fullText, start, end } = getEditorContent();
  textarea.focus();

  if (isReplaceSelected && start !== end) {
    textarea.value = fullText.substring(0, start) + content + fullText.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + content.length;
  } else {
    textarea.value = fullText + content;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  syncContent("editor-to-st");
  toastr.success("内容已插入编辑器", "操作成功");
}

// 构建Prompt与生成参数
function buildPromptConfig() {
  const settings = extension_settings[extensionName];
  const { fullText, selectedText } = getEditorContent();
  const targetLength = Number($("#editor_length_select").val());
  const style = $("#editor_style_select").val();
  const mode = $("input[name='editor_mode']:checked").val();
  const functionType = $("#function_toggle span").text();

  // 模式参数
  const baseParams = mode === "v_mode" 
    ? { temperature: 0.7, top_p: 0.85, repetition_penalty: 1.1 }
    : { temperature: 1.0, top_p: 0.95, repetition_penalty: 1.05 };

  // 继承ST全局参数
  if (settings.inheritStSettings) {
    const stContext = getContext();
    Object.assign(baseParams, {
      temperature: stContext.state.temperature,
      top_p: stContext.state.top_p,
      repetition_penalty: stContext.state.repetition_penalty,
    });
  }

  // 构建Prompt
  let prompt = "";
  let isReplaceSelected = false;

  switch (functionType) {
    case "续写":
      prompt = `你是专业的小说续写助手，严格接在原文末尾续写，不重复原文，风格【${style}】，字数${targetLength}字左右，只输出续写正文，不要额外内容。原文：${fullText}`;
      isReplaceSelected = false;
      break;
    case "扩写":
      if (!selectedText) {
        toastr.warning("请先选中要扩写的内容", "提示");
        return null;
      }
      prompt = `你是专业的小说扩写助手，丰富选中内容的细节，风格【${style}】，字数${targetLength}字左右，只输出扩写后的完整内容。原文：${selectedText} 上下文：${fullText}`;
      isReplaceSelected = true;
      break;
    case "缩写":
      if (!selectedText) {
        toastr.warning("请先选中要缩写的内容", "提示");
        return null;
      }
      prompt = `你是专业的文本缩写助手，精简选中内容，保留核心信息，字数${targetLength}字左右，只输出缩写后的内容。原文：${selectedText}`;
      isReplaceSelected = true;
      break;
    case "改写":
      if (!selectedText) {
        toastr.warning("请先选中要改写的内容", "提示");
        return null;
      }
      prompt = `你是专业的小说改写助手，用【${style}】风格重写选中内容，不改变核心情节，字数${targetLength}字左右，只输出改写后的内容。原文：${selectedText}`;
      isReplaceSelected = true;
      break;
    case "定向续写":
      const customPrompt = $("#custom_prompt_input").val();
      if (!customPrompt) {
        toastr.warning("请先输入自定义续写指令", "提示");
        return null;
      }
      prompt = `你是专业的小说创作助手，遵循指令：${customPrompt}，基于原文创作，风格【${style}】，字数${targetLength}字左右，只输出正文内容。原文：${fullText}`;
      isReplaceSelected = false;
      break;
  }

  return {
    prompt,
    generateParams: { ...baseParams, max_new_tokens: Math.ceil(targetLength * 2), stop: ["\n\n\n", "###"] },
    isReplaceSelected,
  };
}

// 调用ST原生API生成内容
async function generateSingleContent(prompt, generateParams) {
  try {
    // 严格使用ST原生暴露的generateCompletion函数，和模板兼容
    const result = await window.generateCompletion(prompt, generateParams);
    return result.trim().replace(/\n{3,}/g, "\n\n");
  } catch (error) {
    console.error("生成失败:", error);
    toastr.error("生成失败，请检查ST API连接", "错误");
    return null;
  }
}

// 生成多分支内容
async function generateMultiBranchContent() {
  if (isGenerating) return;
  const promptConfig = buildPromptConfig();
  if (!promptConfig) return;

  const { prompt, generateParams, isReplaceSelected } = promptConfig;
  isGenerating = true;

  // 更新UI状态
  $("#action_ai_continue").prop("disabled", true).val("生成中...");
  $("#refresh_results_btn").prop("disabled", true);
  $("#results_cards").html(`<div class="empty-tip">正在生成内容，请稍候...</div>`);

  try {
    // 生成3条差异化内容
    const generateTasks = [
      generateSingleContent(prompt, { ...generateParams, temperature: Math.max(0.5, generateParams.temperature - 0.2) }),
      generateSingleContent(prompt, { ...generateParams }),
      generateSingleContent(prompt, { ...generateParams, temperature: Math.min(1.5, generateParams.temperature + 0.2) }),
    ];

    const results = await Promise.all(generateTasks);
    currentFullResults = results.filter(item => item !== null && item.trim() !== "");
    currentInsertMode = isReplaceSelected;

    if (currentFullResults.length === 0) {
      $("#results_cards").html(`<div class="empty-tip">生成失败，请重试</div>`);
      return;
    }

    // 渲染结果卡片
    renderResultCards();
    toastr.success(`成功生成${currentFullResults.length}条内容`, "完成");
  } catch (error) {
    console.error("批量生成失败:", error);
    $("#results_cards").html(`<div class="empty-tip">生成失败，请重试</div>`);
  } finally {
    isGenerating = false;
    $("#action_ai_continue").prop("disabled", false).val("AI继续");
    $("#refresh_results_btn").prop("disabled", currentFullResults.length === 0);
  }
}

// 渲染结果卡片
function renderResultCards() {
  const container = $("#results_cards");
  container.empty();

  currentFullResults.forEach((content, index) => {
    const previewContent = content.length > 80 ? content.substring(0, 80) + "..." : content;
    const card = $(`
      <div class="cy-result-card">
        <div class="card-preview">${previewContent}</div>
        <input class="menu_button card-use-btn" type="submit" value="使用" data-index="${index}" />
      </div>
    `);
    container.append(card);
  });

  // 绑定使用事件
  $(".card-use-btn").on("click", (event) => {
    const index = $(event.target).data("index");
    const selectedContent = currentFullResults[index];
    if (selectedContent) insertContentToEditor(selectedContent, currentInsertMode);
  });
}

// ==============================================
// 严格和模板一致：jQuery入口函数，流程完全对齐
// ==============================================
jQuery(async () => {
  // 严格和模板一致：先加载HTML文件
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);

  // 严格和模板一致：append到#extensions_settings（ST扩展面板的固定容器）
  $("#extensions_settings").append(settingsHtml);

  // 严格和模板一致：先绑定事件，再加载设置
  // 模板原有设置项事件
  $("#open_editor_btn").on("click", openEditor);
  $("#sync_st_content").on("input", (event) => {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].syncStContent = value;
    saveSettingsDebounced();
  });
  $("#inherit_st_settings").on("input", (event) => {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].inheritStSettings = value;
    saveSettingsDebounced();
  });
  $("#auto_save_story").on("input", (event) => {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].autoSaveStory = value;
    saveSettingsDebounced();
  });
  $("input[name='default_length']").on("change", (event) => {
    const value = $(event.target).val();
    extension_settings[extensionName].defaultLength = value;
    $("#editor_length_select").val(value);
    saveSettingsDebounced();
  });
  $("#default_style").on("change", (event) => {
    const value = $(event.target).val();
    extension_settings[extensionName].defaultStyle = value;
    $("#editor_style_select").val(value);
    saveSettingsDebounced();
  });

  // 编辑器事件绑定
  $("#close_editor_btn").on("click", closeEditor);
  $("#function_toggle").on("click", () => $("#function_drawer_content").toggleClass("show"));
  $(document).on("click", (e) => {
    if (!$(e.target).closest("#function_drawer_trigger").length) {
      $("#function_drawer_content").removeClass("show");
    }
  });
  $(".drawer-item").on("click", (e) => {
    const functionName = $(e.currentTarget).find("span").text();
    $("#function_toggle span").text(functionName);
    $("#function_drawer_content").removeClass("show");
  });
  $("#action_ai_continue").on("click", generateMultiBranchContent);
  $("#refresh_results_btn").on("click", generateMultiBranchContent);
  $("#editor_textarea").on("input", () => syncContent("editor-to-st"));
  $("#send_textarea").on("input", () => syncContent("st-to-editor"));
  $("#action_undo").on("click", () => document.execCommand("undo", false, null));
  $("#action_save").on("click", () => {
    saveCurrentStory();
    toastr.success("内容已保存", "成功");
  });
  $(document).on("keydown", (e) => {
    if (e.key === "Escape" && $("#cy_xiaomeng_editor").hasClass("show")) {
      closeEditor();
    }
  });

  // 严格和模板一致：最后加载设置
  loadSettings();
});
