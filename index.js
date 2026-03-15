// 彩云小梦风格续写插件 - 核心逻辑
// 完全复用SillyTavern原生API，符合官方扩展开发规范
import {
  extension_settings,
  getContext,
  loadExtensionSettings,
  saveSettingsDebounced,
  getCurrentChatId,
} from "../../../extensions.js";

import {
  sendMessage,
  generateCompletion, // ST官方原生文本生成API（核心父级API）
  countTokens, // ST官方内置token计数函数
  eventSource,
  event_types,
} from "../../../../script.js";

// 插件基础配置（必须与仓库/文件夹名称完全一致）
const extensionName = "Continuation_machine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// 默认设置（完全适配ST生态）
const defaultSettings = {
  syncStContent: true,
  inheritStSettings: true,
  autoSaveStory: true,
  mode: "v_mode",
  functionType: "continuation",
  customPrompt: "",
  style: "标准",
  length: "200",
  currentStory: {
    title: "",
    chapter: "",
    content: "",
  },
};

// 全局状态管理
let currentFullResults = [];
let currentInsertMode = false;
let syncDebounceTimer = null;
let isGenerating = false;

// ==============================================
// 初始化与设置加载
// ==============================================
async function loadSettings() {
  // 初始化扩展设置
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  const settings = extension_settings[extensionName];

  // 同步设置到UI
  $("#sync_st_content").prop("checked", settings.syncStContent);
  $("#inherit_st_settings").prop("checked", settings.inheritStSettings);
  $("#auto_save_story").prop("checked", settings.autoSaveStory);
  $(`#${settings.mode}`).prop("checked", true);
  $("#style_select").val(settings.style);
  $("#length_select").val(settings.length);
  $("#custom_prompt_input").val(settings.customPrompt);

  // 恢复故事内容
  if (settings.currentStory) {
    $("#editor_title").val(settings.currentStory.title || "");
    $("#editor_chapter").val(settings.currentStory.chapter || "");
    $("#editor_textarea").val(settings.currentStory.content || "");
  }

  // 更新功能按钮文本
  updateFunctionButtonText(settings.functionType);
}

// 更新功能按钮显示文本
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

// ==============================================
// 编辑器核心交互
// ==============================================
// 打开全屏编辑器
function openEditor() {
  $("#cy_xiaomeng_editor").addClass("show");
  const settings = extension_settings[extensionName];

  // 同步ST输入框内容到编辑器
  if (settings.syncStContent) {
    const stInputText = $("#send_textarea").val() || "";
    if (stInputText && stInputText !== $("#editor_textarea").val()) {
      $("#editor_textarea").val(stInputText);
    }
  }

  $("#editor_textarea").focus();
}

// 关闭全屏编辑器
function closeEditor() {
  $("#cy_xiaomeng_editor").removeClass("show");
  const settings = extension_settings[extensionName];

  // 同步编辑器内容回ST输入框
  if (settings.syncStContent) {
    const editorText = $("#editor_textarea").val() || "";
    $("#send_textarea").val(editorText).trigger("input");
  }

  // 自动保存故事内容
  if (settings.autoSaveStory) {
    saveCurrentStory();
  }
}

// 保存当前故事内容
function saveCurrentStory() {
  const settings = extension_settings[extensionName];
  settings.currentStory = {
    title: $("#editor_title").val() || "",
    chapter: $("#editor_chapter").val() || "",
    content: $("#editor_textarea").val() || "",
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
      const editorText = $("#editor_textarea").val() || "";
      $("#send_textarea").val(editorText).trigger("input");
    } else if (direction === "st-to-editor") {
      const stText = $("#send_textarea").val() || "";
      $("#editor_textarea").val(stText);
    }

    // 自动保存
    if (extension_settings[extensionName].autoSaveStory) {
      saveCurrentStory();
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

  // 替换选中内容/追加到文末
  if (isReplaceSelected && start !== end) {
    textarea.value = fullText.substring(0, start) + content + fullText.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + content.length;
  } else {
    textarea.value = fullText + content;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  // 触发同步与保存
  syncContent("editor-to-st");
  toastr.success("内容已插入编辑器", "操作成功");
}

// ==============================================
// 核心：调用ST父级API生成内容
// ==============================================
// 构建生成Prompt（适配不同功能）
function buildPromptConfig() {
  const settings = extension_settings[extensionName];
  const { fullText, selectedText } = getEditorContent();
  const targetLength = Number(settings.length);

  // 基础模式配置：V模式严谨/O模式放飞
  const modeConfig = {
    v_mode: {
      temperature: 0.7,
      top_p: 0.85,
      repetition_penalty: 1.1,
    },
    o_mode: {
      temperature: 1.0,
      top_p: 0.95,
      repetition_penalty: 1.05,
    },
  };

  // 基础参数
  let baseParams = modeConfig[settings.mode];
  let prompt = "";
  let isReplaceSelected = false;

  // 1. 继承ST全局生成参数（用户开启时）
  if (settings.inheritStSettings) {
    const stContext = getContext();
    baseParams = {
      ...baseParams,
      temperature: stContext.state.temperature,
      top_p: stContext.state.top_p,
      repetition_penalty: stContext.state.repetition_penalty,
      top_k: stContext.state.top_k,
      typical_p: stContext.state.typical_p,
      tfs: stContext.state.tfs,
    };
  }

  // 2. 根据功能类型构建Prompt
  switch (settings.functionType) {
    // 续写功能（核心）
    case "continuation":
      prompt = `你是专业的网络小说续写助手，严格遵循以下要求创作：
1. 基于用户提供的小说原文，**严格接在原文最后一句的末尾无缝续写**，绝对不要重复原文内容，只输出续写的正文，不要任何标题、解释、说明、前缀
2. 续写风格：【${settings.style}】，严格贴合原文的人物设定、故事走向、叙事节奏、语言风格，情节连贯、逻辑自洽
3. 续写字数：严格控制在${targetLength}字左右，误差不超过10%
4. 只输出续写的正文内容，不要添加任何额外内容

小说原文：
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
1. 基于用户选中的文本内容，进行细节扩写，丰富人物动作、表情、心理活动、场景描写、对话细节，让内容更生动饱满
2. 扩写风格：【${settings.style}】，严格贴合原文的人物设定、故事背景、语言风格，不改变原文核心情节与意思
3. 扩写后字数：严格控制在${targetLength}字左右，误差不超过10%
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
1. 基于用户选中的文本内容，进行精简缩写，保留核心情节、关键信息、对话核心，去除冗余修饰
2. 缩写后内容逻辑连贯、语句通顺，贴合原文语言风格
3. 缩写后字数：严格控制在${targetLength}字左右，误差不超过10%
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
1. 基于用户选中的文本内容，用【${settings.style}】的风格进行重写，不改变原文核心情节与关键信息，仅优化表达方式、叙事视角、描写风格
2. 改写后内容逻辑连贯、语句通顺，符合所选风格的特点
3. 改写后字数：严格控制在${targetLength}字左右，误差不超过10%
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
      prompt = `你是专业的小说创作助手，严格遵循用户的自定义指令创作：
1. 用户自定义指令：${settings.customPrompt}
2. 基于用户提供的小说原文创作，严格贴合原文的人物设定、故事走向、语言风格，逻辑连贯自然
3. 创作风格：【${settings.style}】，字数严格控制在${targetLength}字左右，误差不超过10%
4. 只输出符合要求的正文内容，不要任何解释、说明、前缀

小说原文：
${fullText}`;
      isReplaceSelected = false;
      break;

    default:
      prompt = "";
  }

  // 额外补充自定义指令
  if (settings.functionType !== "custom" && settings.customPrompt.trim()) {
    prompt += `\n额外要求：${settings.customPrompt}`;
  }

  // 计算生成所需的max_new_tokens（适配ST父级API）
  const maxNewTokens = Math.ceil(targetLength * 2); // 汉字与token换算比例1:1.5~2，预留足够空间

  return {
    prompt,
    generateParams: {
      ...baseParams,
      max_new_tokens: maxNewTokens,
      stop: ["\n\n\n", "###", "原文："], // 停止词，避免生成冗余内容
    },
    isReplaceSelected,
  };
}

// 调用ST父级API生成单条内容
async function generateSingleContent(prompt, generateParams) {
  try {
    // 核心：调用SillyTavern原生父级API，自动适配所有已连接的后端
    // 该函数会自动处理API鉴权、后端适配、错误重试，完全复用ST的核心能力
    const rawResult = await generateCompletion(prompt, generateParams);
    
    // 清理生成结果，去除多余换行、首尾空格、无关内容
    return rawResult.trim().replace(/\n{3,}/g, "\n\n").replace(/^["']|["']$/g, "");
  } catch (error) {
    console.error("ST父级API调用失败:", error);
    toastr.error(`生成失败: ${error.message || "请检查ST API连接状态"}`, "API调用错误");
    return null;
  }
}

// 生成多分支内容（3条不同走向，复刻彩云小梦）
async function generateMultiBranchContent() {
  // 防重复生成
  if (isGenerating) return;
  const promptConfig = buildPromptConfig();
  if (!promptConfig) return;

  const { prompt, generateParams, isReplaceSelected } = promptConfig;
  isGenerating = true;

  // 更新UI状态
  $("#action_ai_continue").prop("disabled", true).val("生成中...");
  $("#refresh_results_btn").prop("disabled", true);
  $("#results_cards").html(`<div class="empty-tip">正在调用ST API生成多分支内容，请稍候...</div>`);

  try {
    // 并行生成3条差异化内容（调整温度实现不同走向）
    const generateTasks = [
      // 保守稳定版
      generateSingleContent(prompt, { ...generateParams, temperature: Math.max(0.5, generateParams.temperature - 0.2) }),
      // 平衡版
      generateSingleContent(prompt, { ...generateParams }),
      // 脑洞版
      generateSingleContent(prompt, { ...generateParams, temperature: Math.min(1.5, generateParams.temperature + 0.2) }),
    ];

    const results = await Promise.all(generateTasks);
    // 过滤失败结果
    currentFullResults = results.filter(item => item !== null && item.trim() !== "");
    currentInsertMode = isReplaceSelected;

    if (currentFullResults.length === 0) {
      $("#results_cards").html(`<div class="empty-tip">生成失败，请检查ST API连接状态后重试</div>`);
      return;
    }

    // 渲染结果卡片
    renderResultCards();
    toastr.success(`成功生成${currentFullResults.length}条续写内容`, "生成完成");
  } catch (error) {
    console.error("批量生成失败:", error);
    $("#results_cards").html(`<div class="empty-tip">生成失败: ${error.message || "未知错误"}</div>`);
  } finally {
    // 恢复UI状态
    isGenerating = false;
    $("#action_ai_continue").prop("disabled", false).val("AI继续");
    $("#refresh_results_btn").prop("disabled", currentFullResults.length === 0);
  }
}

// 渲染结果卡片（横向滚动，复刻彩云小梦）
function renderResultCards() {
  const container = $("#results_cards");
  container.empty();

  currentFullResults.forEach((content, index) => {
    // 预览内容取前80字，超出用省略号
    const previewContent = content.length > 80 ? content.substring(0, 80) + "..." : content;
    const card = $(`
      <div class="cy-result-card">
        <div class="card-preview">${previewContent}</div>
        <input class="menu_button card-use-btn" type="submit" value="使用" data-index="${index}" />
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

// ==============================================
// 插件入口与事件绑定
// ==============================================
jQuery(async () => {
  // 加载UI模板
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
  $("#extensions_settings").append(settingsHtml);

  // 加载设置
  await loadSettings();

  // 入口按钮事件
  $("#open_editor_btn").on("click", openEditor);
  $("#close_editor_btn").on("click", closeEditor);

  // 设置变更事件
  $("#sync_st_content").on("change", (e) => {
    extension_settings[extensionName].syncStContent = Boolean($(e.target).prop("checked"));
    saveSettingsDebounced();
  });
  $("#inherit_st_settings").on("change", (e) => {
    extension_settings[extensionName].inheritStSettings = Boolean($(e.target).prop("checked"));
    saveSettingsDebounced();
  });
  $("#auto_save_story").on("change", (e) => {
    extension_settings[extensionName].autoSaveStory = Boolean($(e.target).prop("checked"));
    saveSettingsDebounced();
  });

  // 模式切换事件
  $("input[name='editor_mode']").on("change", (e) => {
    extension_settings[extensionName].mode = $(e.target).val();
    saveSettingsDebounced();
  });

  // 功能抽屉事件
  $("#function_toggle").on("click", () => {
    $("#function_drawer_content").toggleClass("show");
  });
  // 点击外部关闭抽屉
  $(document).on("click", (e) => {
    if (!$(e.target).closest("#function_drawer_trigger").length) {
      $("#function_drawer_content").removeClass("show");
    }
  });
  // 功能项选择
  $(".drawer-item").on("click", (e) => {
    const functionType = $(e.currentTarget).data("function");
    extension_settings[extensionName].functionType = functionType;
    saveSettingsDebounced();
    updateFunctionButtonText(functionType);
    $("#function_drawer_content").removeClass("show");
  });

  // 基础设置变更
  $("#custom_prompt_input").on("input", (e) => {
    extension_settings[extensionName].customPrompt = $(e.target).val();
    saveSettingsDebounced();
  });
  $("#style_select").on("change", (e) => {
    extension_settings[extensionName].style = $(e.target).val();
    saveSettingsDebounced();
  });
  $("#length_select").on("change", (e) => {
    extension_settings[extensionName].length = $(e.target).val();
    saveSettingsDebounced();
  });

  // 生成按钮事件
  $("#action_ai_continue").on("click", generateMultiBranchContent);
  $("#refresh_results_btn").on("click", generateMultiBranchContent);

  // 内容同步事件
  $("#editor_textarea").on("input", () => syncContent("editor-to-st"));
  $("#send_textarea").on("input", () => syncContent("st-to-editor"));

  // 编辑操作栏事件
  $("#action_undo").on("click", () => document.execCommand("undo", false, null));
  $("#action_redo").on("click", () => document.execCommand("redo", false, null));
  $("#action_modify").on("click", () => {
    // 快速选中当前行
    const textarea = $("#editor_textarea")[0];
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

  // ESC键关闭编辑器
  $(document).on("keydown", (e) => {
    if (e.key === "Escape" && $("#cy_xiaomeng_editor").hasClass("show")) {
      closeEditor();
    }
  });

  // 监听ST API连接状态变化
  eventSource.on(event_types.API_CONNECTED, () => {
    toastr.info("ST API已连接，续写插件已就绪", "连接成功");
  });
  eventSource.on(event_types.API_DISCONNECTED, () => {
    toastr.warning("ST API已断开，续写功能暂时不可用", "连接断开");
  });
});
