type FeatureItem = {
  title: string;
  description: string;
  actions: string[];
};

type UsageGuideSectionProps = {
  exeDownloadUrl: string;
  extensionDownloadUrl: string;
};

const FEATURE_ITEMS: FeatureItem[] = [
  {
    title: "商品库",
    description: "管理商品数据，支持查看、排序、批量删除与手动创建商品链接。",
    actions: ["插件拖拽采集商品", "手动上传白底图 + 描述", "选中商品后执行分析/图词/短视频"]
  },
  {
    title: "AI分析结果",
    description: "集中查看 AI 结构化分析、图词结果、短视频脚本与视频片段状态。",
    actions: ["查看商品分析摘要", "调试与复制图词/脚本", "上传素材并触发视频片段生成"]
  },
  {
    title: "API Key管理",
    description: "统一维护系统 API Key 与页面登录状态，确保各能力可正常调用。",
    actions: ["输入管理密码登录", "配置并保存统一 API Key", "必要时刷新或退出管理会话"]
  }
];

const QUICK_START_STEPS = [
  "先进入 API Key管理，输入页面密码并保存统一 API Key。",
  "回到 商品库，通过插件拖拽采集商品，或用“手动创建商品链接”补充商品。",
  "选择目标商品点击“分析”，等待一阶段分析完成。",
  "在分析完成后点击“图词请求”，生成主图/详情图提示词。",
  "如果需要短视频，再点击“短视频”，并在 AI分析结果页完成脚本与视频片段流程。"
];

const TIPS = [
  "生成失败时先检查 API Key 是否有效，再重试对应任务。",
  "建议先确认商品主图和描述质量，避免影响 AI 输出质量。",
  "视频片段生成是异步任务，可在 AI分析结果页持续查看状态。"
];

export function UsageGuideSection({ exeDownloadUrl, extensionDownloadUrl }: UsageGuideSectionProps) {
  return (
    <section className="usage-guide-page">
      <article className="usage-guide-intro">
        <h3>网站功能总览</h3>
        <p>本页面用于帮助你快速理解系统功能与标准使用顺序，建议新用户先按下方“快速上手流程”操作。</p>
      </article>

      <article className="usage-guide-card usage-guide-download-panel">
        <h4>客户端下载</h4>
        <p>可按需下载浏览器插件或 Windows EXE。插件用于抓取上传，EXE 用于本地一体化运行。</p>
        <div className="usage-guide-download-actions">
          <a className="primary-btn usage-guide-download-link" href={extensionDownloadUrl} rel="noreferrer" target="_blank">
            下载插件（ZIP）
          </a>
          <a className="primary-btn usage-guide-download-link" href={exeDownloadUrl} rel="noreferrer" target="_blank">
            下载客户端（EXE）
          </a>
        </div>
      </article>

      <section className="usage-guide-grid">
        {FEATURE_ITEMS.map((feature) => (
          <article className="usage-guide-card" key={feature.title}>
            <h4>{feature.title}</h4>
            <p>{feature.description}</p>
            <ul>
              {feature.actions.map((action) => (
                <li key={`${feature.title}_${action}`}>{action}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <article className="usage-guide-card usage-guide-steps">
        <h4>快速上手流程</h4>
        <ol>
          {QUICK_START_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      <article className="usage-guide-card usage-guide-tips">
        <h4>使用建议</h4>
        <ul>
          {TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </article>
    </section>
  );
}
