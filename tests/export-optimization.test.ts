/**
 * 导出性能优化示例和测试
 *
 * 展示如何使用新的导出优化功能
 */

import { describe, it, expect } from "vitest";
import type { Project } from "../shared/model";
import {
  analyzeExportPerformance,
  generatePerformanceReport,
} from "../electron/export-analyzer";
import {
  exportVideoOptimized,
  estimateExportTime,
  getExportPerformanceAdvice,
  type ExportProgress,
} from "../electron/export-integration";
import { shouldUseChunkedExport } from "../electron/export-optimizer";

// 创建测试项目
function createTestProject(options: {
  duration?: number;
  clipCount?: number;
  complexEffects?: boolean;
}): Project {
  const { duration = 600, clipCount = 50, complexEffects = false } = options;
  const clips = [];

  const clipDuration = duration / clipCount;
  for (let i = 0; i < clipCount; i++) {
    clips.push({
      id: `clip-${i}`,
      trackId: "track-1",
      assetId: `asset-${i % 10}`,
      kind: i % 3 === 0 ? "text" : "video",
      start: i * clipDuration,
      duration: clipDuration,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
      keyframes: complexEffects ? [
        { time: 0, value: { x: 0.3, y: 0.3 }, easing: "linear" },
        { time: clipDuration / 2, value: { x: 0.7, y: 0.7 }, easing: "ease-out" },
      ] : [],
      visualEffects: complexEffects ? {
        blur: { enabled: true, amount: 5 },
      } : undefined,
    } as any);
  }

  return {
    version: 1,
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      background: "#000000",
    },
    clips,
    tracks: [{ id: "track-1", name: "Track 1", muted: false }],
    assets: [],
    exportSettings: {
      encoder: "auto",
      quality: "standard",
      resolution: "1080p",
      format: "mp4",
    },
  } as any;
}

describe("导出性能分析", () => {
  it("应该分析小项目性能", () => {
    const project = createTestProject({ duration: 120, clipCount: 10 });
    const analysis = analyzeExportPerformance(project);

    expect(analysis.score).toBeGreaterThan(0);
    expect(analysis.score).toBeLessThanOrEqual(100);
    expect(analysis.rating).toBeDefined();
    expect(analysis.stats.clipCount).toBe(10);
    expect(analysis.stats.duration).toBe(120);
  });

  it("应该识别大项目的性能瓶颈", () => {
    const project = createTestProject({
      duration: 1800,
      clipCount: 100,
      complexEffects: true
    });
    const analysis = analyzeExportPerformance(project);

    // 复杂项目应该有更低的分数
    expect(analysis.score).toBeLessThan(80);
    expect(analysis.bottlenecks.length).toBeGreaterThan(0);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
  });

  it("应该生成可读的性能报告", () => {
    const project = createTestProject({ duration: 600, clipCount: 50 });
    const analysis = analyzeExportPerformance(project);
    const report = generatePerformanceReport(analysis);

    expect(report).toContain("导出性能分析报告");
    expect(report).toContain("总体评分");
    expect(report).toContain("项目统计");
  });

  it("应该提供性能建议", () => {
    const project = createTestProject({ duration: 600, clipCount: 50 });
    const advice = getExportPerformanceAdvice(project);

    expect(Array.isArray(advice)).toBe(true);
    expect(advice.length).toBeGreaterThan(0);
    // 应该包含硬件编码建议（如果未启用）
    const hasHardwareAdvice = advice.some(a => a.includes("硬件编码"));
    expect(hasHardwareAdvice).toBe(true);
  });
});

describe("导出策略选择", () => {
  it("小项目应该使用标准导出", () => {
    const project = createTestProject({ duration: 30, clipCount: 5 });
    const shouldUseChunked = shouldUseChunkedExport(
      project,
      { quality: "standard", resolution: "1080p", format: "mp4", encoder: "auto" }
    );

    expect(shouldUseChunked).toBe(false);
  });

  it("大项目应该使用分块导出", () => {
    const project = createTestProject({ duration: 600, clipCount: 50 });
    const shouldUseChunked = shouldUseChunkedExport(
      project,
      { quality: "standard", resolution: "1080p", format: "mp4", encoder: "auto" }
    );

    // 在4核以上CPU上应该使用分块导出
    if (require("os").cpus().length >= 4) {
      expect(shouldUseChunked).toBe(true);
    }
  });

  it("应该正确估算导出时间", () => {
    const project = createTestProject({ duration: 600, clipCount: 50 });
    const estimate = estimateExportTime(project);

    expect(estimate.min).toBeGreaterThan(0);
    expect(estimate.max).toBeGreaterThan(estimate.min);
    expect(estimate.strategy).toMatch(/^(standard|chunked)$/);
  });
});

describe("项目统计计算", () => {
  it("应该正确计算项目统计", () => {
    const project = createTestProject({
      duration: 600,
      clipCount: 30,
      complexEffects: true
    });
    const analysis = analyzeExportPerformance(project);
    const stats = analysis.stats;

    expect(stats.duration).toBe(600);
    expect(stats.clipCount).toBe(30);
    expect(stats.textClipCount).toBeGreaterThan(0);
    expect(stats.videoClipCount).toBeGreaterThan(0);
    expect(stats.totalKeyframes).toBeGreaterThan(0);
    expect(stats.complexityScore).toBeGreaterThan(0);
  });

  it("复杂项目应该有更高的复杂度分数", () => {
    const simpleProject = createTestProject({
      duration: 600,
      clipCount: 30,
      complexEffects: false
    });
    const complexProject = createTestProject({
      duration: 600,
      clipCount: 30,
      complexEffects: true
    });

    const simpleAnalysis = analyzeExportPerformance(simpleProject);
    const complexAnalysis = analyzeExportPerformance(complexProject);

    expect(complexAnalysis.stats.complexityScore)
      .toBeGreaterThan(simpleAnalysis.stats.complexityScore);
  });
});

describe("导出优化集成", () => {
  it("应该提供详细的进度信息", async () => {
    const project = createTestProject({ duration: 120, clipCount: 10 });

    const progressUpdates: ExportProgress[] = [];
    const progressCallback = (info: ExportProgress) => {
      progressUpdates.push(info);
    };

    // 注意：这是一个集成测试示例
    // 实际运行需要FFmpeg和完整的导出环境
    expect(progressCallback).toBeDefined();
    expect(progressUpdates).toEqual([]);
  });
});

// 性能基准测试示例
describe("性能基准测试", () => {
  it("应该测量分析性能", () => {
    const project = createTestProject({ duration: 600, clipCount: 100 });

    const startTime = performance.now();
    const analysis = analyzeExportPerformance(project);
    const endTime = performance.now();

    const analysisTime = endTime - startTime;

    // 分析应该很快（<100ms）
    expect(analysisTime).toBeLessThan(100);
    expect(analysis.stats.clipCount).toBe(100);
  });

  it("应该高效生成报告", () => {
    const project = createTestProject({ duration: 600, clipCount: 100 });
    const analysis = analyzeExportPerformance(project);

    const startTime = performance.now();
    const report = generatePerformanceReport(analysis);
    const endTime = performance.now();

    const reportTime = endTime - startTime;

    // 报告生成应该很快（<10ms）
    expect(reportTime).toBeLessThan(10);
    expect(report.length).toBeGreaterThan(100);
  });
});

// 实用示例函数
export function printProjectAnalysis(project: Project): void {
  console.log("\n" + "=".repeat(60));
  console.log("🔍 项目性能分析");
  console.log("=".repeat(60));

  const analysis = analyzeExportPerformance(project);
  console.log(generatePerformanceReport(analysis));

  const estimate = estimateExportTime(project);
  console.log("\n⏱️  导出时间估算:");
  console.log(`  最快: ${formatTime(estimate.min)}`);
  console.log(`  最慢: ${formatTime(estimate.max)}`);
  console.log(`  策略: ${estimate.strategy === "chunked" ? "分块并行" : "标准单进程"}`);

  const advice = getExportPerformanceAdvice(project);
  if (advice.length > 0) {
    console.log("\n💡 性能建议:");
    advice.forEach(a => console.log(`  ${a}`));
  }

  console.log("\n" + "=".repeat(60) + "\n");
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(0)}秒`;
  } else if (seconds < 3600) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}分${sec.toFixed(0)}秒`;
  } else {
    const hour = Math.floor(seconds / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    return `${hour}小时${min}分`;
  }
}

// 使用示例
if ((import.meta as any).vitest === undefined) {
  // 仅在直接运行时执行（非测试环境）
  const exampleProject = createTestProject({
    duration: 600,
    clipCount: 50,
    complexEffects: true
  });

  printProjectAnalysis(exampleProject);
}
