/**
 * 导出性能分析工具
 *
 * 分析项目的导出性能特征，识别瓶颈并提供优化建议
 */

import os from "node:os";
import { type Project, type Clip, projectDuration } from "../shared/model";
import type { ExportSettings } from "../shared/export-settings";
import { resolvedExportSettings, exportDimensions } from "../shared/export-settings";

/** 性能分析结果 */
export interface PerformanceAnalysis {
  /** 总体评分 (0-100) */
  score: number;
  /** 评级 */
  rating: "excellent" | "good" | "fair" | "poor";
  /** 预估导出时间（秒） */
  estimatedTime: number;
  /** 瓶颈分析 */
  bottlenecks: Bottleneck[];
  /** 优化建议 */
  recommendations: Recommendation[];
  /** 项目统计 */
  stats: ProjectStats;
}

/** 性能瓶颈 */
interface Bottleneck {
  /** 瓶颈类型 */
  type: "cpu" | "gpu" | "memory" | "io" | "complexity";
  /** 严重程度 (0-100) */
  severity: number;
  /** 描述 */
  description: string;
  /** 受影响的片段 */
  affectedClips?: string[];
}

/** 优化建议 */
interface Recommendation {
  /** 优先级 */
  priority: "high" | "medium" | "low";
  /** 类型 */
  type: "settings" | "hardware" | "project" | "workflow";
  /** 描述 */
  description: string;
  /** 预期提升 */
  expectedGain: string;
  /** 实施难度 */
  difficulty: "easy" | "medium" | "hard";
}

/** 项目统计 */
interface ProjectStats {
  duration: number;
  clipCount: number;
  trackCount: number;
  textClipCount: number;
  videoClipCount: number;
  imageClipCount: number;
  totalKeyframes: number;
  effectsCount: number;
  transitionsCount: number;
  averageClipDuration: number;
  complexityScore: number;
  estimatedMemoryUsage: number; // MB
  estimatedGpuLoad: number; // 0-100
  estimatedCpuLoad: number; // 0-100
}

/**
 * 分析项目的导出性能
 */
export function analyzeExportPerformance(project: Project): PerformanceAnalysis {
  const stats = calculateProjectStats(project);
  const bottlenecks = identifyBottlenecks(project, stats);
  const recommendations = generateRecommendations(project, stats, bottlenecks);

  // 计算总体评分
  const score = calculatePerformanceScore(stats, bottlenecks);
  const rating = score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "fair" : "poor";

  // 预估导出时间
  const estimatedTime = estimateExportDuration(project, stats);

  return {
    score,
    rating,
    estimatedTime,
    bottlenecks,
    recommendations,
    stats,
  };
}

/** 计算项目统计信息 */
function calculateProjectStats(project: Project): ProjectStats {
  const duration = projectDuration(project);
  const clipCount = project.clips.length;
  const trackCount = project.tracks.length;

  const textClipCount = project.clips.filter(c => c.kind === "text").length;
  const videoClipCount = project.clips.filter(c => c.kind === "video").length;
  const imageClipCount = project.clips.filter(c => c.kind === "image").length;

  const totalKeyframes = project.clips.reduce((sum, c) => sum + c.keyframes.length, 0);
  const effectsCount = project.clips.reduce(
    (sum, c) => sum + (c.visualEffects ? Object.keys(c.visualEffects).length : 0),
    0
  );

  // 简化的过渡计数（基于关键帧密度）
  const transitionsCount = project.clips.filter(c => c.keyframes.length >= 2).length;

  const averageClipDuration = clipCount > 0
    ? project.clips.reduce((sum, c) => sum + c.duration, 0) / clipCount
    : 0;

  // 复杂度评分
  const complexityScore = calculateComplexityScore(project);

  // 内存使用估算
  const settings = resolvedExportSettings(project.exportSettings);
  const dimensions = exportDimensions(project.canvas, settings.resolution);
  const frameSize = dimensions.width * dimensions.height * 4; // RGBA
  const estimatedMemoryUsage = (frameSize * clipCount * 2) / (1024 * 1024); // MB

  // GPU/CPU负载估算
  const estimatedGpuLoad = calculateGpuLoad(project, settings);
  const estimatedCpuLoad = calculateCpuLoad(project, stats);

  return {
    duration,
    clipCount,
    trackCount,
    textClipCount,
    videoClipCount,
    imageClipCount,
    totalKeyframes,
    effectsCount,
    transitionsCount,
    averageClipDuration,
    complexityScore,
    estimatedMemoryUsage,
    estimatedGpuLoad,
    estimatedCpuLoad,
  };
}

/** 计算项目复杂度评分 */
function calculateComplexityScore(project: Project): number {
  let score = 0;

  for (const clip of project.clips) {
    // 基础分数
    score += 1;

    // 关键帧动画
    score += clip.keyframes.length * 2;

    // 视觉效果
    if (clip.visualEffects) {
      score += Object.keys(clip.visualEffects).length * 5;
    }

    // 行为动画
    if (clip.behaviors && clip.behaviors.length > 0) {
      score += clip.behaviors.length * 3;
    }

    // 文本和形状（需要光栅化）
    if (clip.kind === "text" || clip.kind === "shape") {
      score += 4;
    }

    // 速度变化
    if (clip.speed !== 1) {
      score += 2;
    }

    // 裁剪
    if (clip.crop && Object.values(clip.crop).some(v => v > 0)) {
      score += 1;
    }
  }

  // 摄像机动画
  if (project.camera) {
    score += 10;
  }

  return score;
}

/** 计算GPU负载 */
function calculateGpuLoad(project: Project, settings: Required<ExportSettings>): number {
  let load = 0;

  // 硬件编码器使用GPU
  if (settings.encoder !== "software") {
    load += 40;
  }

  // 高分辨率增加GPU负载
  if (settings.resolution >= 1) {
    load += 20;
  }

  // 复杂效果
  const effectsCount = project.clips.reduce(
    (sum, c) => sum + (c.visualEffects ? Object.keys(c.visualEffects).length : 0),
    0
  );
  load += Math.min(30, effectsCount * 3);

  return Math.min(100, load);
}

/** 计算CPU负载 */
function calculateCpuLoad(project: Project, stats: ProjectStats): number {
  let load = 30; // 基础负载

  // 复杂度
  load += Math.min(40, stats.complexityScore / 10);

  // 文本光栅化
  load += Math.min(20, stats.textClipCount * 2);

  // 软件编码
  const settings = resolvedExportSettings(project.exportSettings);
  if (settings.encoder === "software") {
    load += 30;
  }

  return Math.min(100, load);
}

/** 识别性能瓶颈 */
function identifyBottlenecks(project: Project, stats: ProjectStats): Bottleneck[] {
  const bottlenecks: Bottleneck[] = [];
  const settings = resolvedExportSettings(project.exportSettings);

  // CPU瓶颈
  if (stats.estimatedCpuLoad > 80) {
    bottlenecks.push({
      type: "cpu",
      severity: stats.estimatedCpuLoad,
      description: `CPU负载预计达到 ${stats.estimatedCpuLoad}%，可能导致导出缓慢`,
    });
  }

  // GPU瓶颈（未启用硬件加速）
  if (settings.encoder === "software" && (process.platform === "win32" || process.platform === "darwin")) {
    bottlenecks.push({
      type: "gpu",
      severity: 70,
      description: "未启用硬件编码，无法利用GPU加速",
    });
  }

  // 内存瓶颈
  const availableMemory = os.totalmem() / (1024 * 1024 * 1024); // GB
  if (stats.estimatedMemoryUsage > availableMemory * 0.5 * 1024) {
    bottlenecks.push({
      type: "memory",
      severity: 60,
      description: `预计内存使用 ${(stats.estimatedMemoryUsage / 1024).toFixed(1)} GB，可能接近系统限制`,
    });
  }

  // 复杂度瓶颈
  if (stats.complexityScore > 200) {
    const complexClips = project.clips
      .filter(c =>
        c.keyframes.length > 5 ||
        (c.visualEffects && Object.keys(c.visualEffects).length > 2)
      )
      .map(c => c.id);

    bottlenecks.push({
      type: "complexity",
      severity: Math.min(100, stats.complexityScore / 3),
      description: `项目复杂度高（评分 ${stats.complexityScore}），包含大量动画和效果`,
      affectedClips: complexClips,
    });
  }

  // I/O瓶颈（大量小片段）
  if (stats.clipCount > 100 && stats.averageClipDuration < 2) {
    bottlenecks.push({
      type: "io",
      severity: 50,
      description: `包含 ${stats.clipCount} 个片段，平均时长仅 ${stats.averageClipDuration.toFixed(1)} 秒，频繁切换可能影响性能`,
    });
  }

  return bottlenecks.sort((a, b) => b.severity - a.severity);
}

/** 生成优化建议 */
function generateRecommendations(
  project: Project,
  stats: ProjectStats,
  bottlenecks: Bottleneck[],
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const settings = resolvedExportSettings(project.exportSettings);

  // 硬件加速建议
  if (settings.encoder === "software" && (process.platform === "win32" || process.platform === "darwin")) {
    recommendations.push({
      priority: "high",
      type: "settings",
      description: "启用硬件编码（GPU加速）",
      expectedGain: "速度提升 3-5 倍",
      difficulty: "easy",
    });
  }

  // 质量设置建议
  if (settings.quality === "high" && stats.duration > 300) {
    recommendations.push({
      priority: "medium",
      type: "settings",
      description: "长视频使用中等质量设置",
      expectedGain: "速度提升 30-40%，视觉差异极小",
      difficulty: "easy",
    });
  }

  // 分辨率建议
  if (settings.resolution > 1 && stats.duration > 600) {
    recommendations.push({
      priority: "medium",
      type: "settings",
      description: "超长视频考虑降低输出分辨率",
      expectedGain: "速度提升 20-30%",
      difficulty: "easy",
    });
  }

  // 并行导出建议
  if (stats.duration > 60 && stats.clipCount > 20 && os.cpus().length >= 4) {
    recommendations.push({
      priority: "high",
      type: "workflow",
      description: "使用分块并行导出（自动启用）",
      expectedGain: "速度提升 2-3 倍",
      difficulty: "easy",
    });
  }

  // 项目优化建议
  if (stats.effectsCount > 20) {
    recommendations.push({
      priority: "low",
      type: "project",
      description: "减少不必要的视觉效果",
      expectedGain: "速度提升 10-20%",
      difficulty: "medium",
    });
  }

  // 文本优化建议
  if (stats.textClipCount > 10) {
    recommendations.push({
      priority: "low",
      type: "project",
      description: "合并相邻的文本片段",
      expectedGain: "减少光栅化开销，速度提升 5-10%",
      difficulty: "medium",
    });
  }

  // CPU核心数建议
  const cpuCount = os.cpus().length;
  if (cpuCount < 4 && stats.clipCount > 50) {
    recommendations.push({
      priority: "low",
      type: "hardware",
      description: `当前CPU核心数较少（${cpuCount}核），考虑升级硬件以获得更好的导出性能`,
      expectedGain: "多核CPU可提升 2-4 倍速度",
      difficulty: "hard",
    });
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}

/** 计算性能评分 */
function calculatePerformanceScore(stats: ProjectStats, bottlenecks: Bottleneck[]): number {
  let score = 100;

  // 根据瓶颈扣分
  for (const bottleneck of bottlenecks) {
    score -= bottleneck.severity * 0.3;
  }

  // 根据复杂度扣分
  score -= Math.min(30, stats.complexityScore / 10);

  // 根据CPU/GPU负载扣分
  score -= (stats.estimatedCpuLoad - 50) * 0.2;
  score -= (stats.estimatedGpuLoad - 50) * 0.1;

  return Math.max(0, Math.min(100, score));
}

/** 预估导出时长 */
function estimateExportDuration(project: Project, stats: ProjectStats): number {
  const settings = resolvedExportSettings(project.exportSettings);

  // 基础速率：实时渲染的倍数
  let rate = 1.0;

  // 复杂度影响
  rate *= 1 + stats.complexityScore / 500;

  // 质量影响
  const qualityMultiplier = {
    low: 0.7,
    medium: 1.0,
    high: 1.5,
  };
  rate *= qualityMultiplier[settings.quality];

  // 分辨率影响
  rate *= 1 + settings.resolution * 0.3;

  // 硬件加速
  if (settings.encoder !== "software") {
    rate *= 0.3; // GPU加速快很多
  }

  // 并行导出加速
  const cpuCount = os.cpus().length;
  if (stats.duration > 60 && stats.clipCount > 20 && cpuCount >= 4) {
    rate *= 0.5; // 并行导出可以显著加速
  }

  return Math.max(10, stats.duration * rate);
}

/**
 * 生成人类可读的性能报告
 */
export function generatePerformanceReport(analysis: PerformanceAnalysis): string {
  const lines: string[] = [];

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("📊 导出性能分析报告");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  // 总体评分
  const ratingEmoji = {
    excellent: "🌟",
    good: "👍",
    fair: "⚠️",
    poor: "🔴",
  };
  lines.push(`总体评分: ${ratingEmoji[analysis.rating]} ${analysis.score.toFixed(0)}/100 (${analysis.rating})`);
  lines.push(`预估导出时间: ${formatDuration(analysis.estimatedTime)}`);
  lines.push("");

  // 项目统计
  lines.push("📈 项目统计:");
  lines.push(`  • 视频时长: ${formatDuration(analysis.stats.duration)}`);
  lines.push(`  • 片段数量: ${analysis.stats.clipCount} (视频: ${analysis.stats.videoClipCount}, 图片: ${analysis.stats.imageClipCount}, 文本: ${analysis.stats.textClipCount})`);
  lines.push(`  • 关键帧总数: ${analysis.stats.totalKeyframes}`);
  lines.push(`  • 视觉效果: ${analysis.stats.effectsCount}`);
  lines.push(`  • 复杂度评分: ${analysis.stats.complexityScore}`);
  lines.push(`  • 预计CPU负载: ${analysis.stats.estimatedCpuLoad}%`);
  lines.push(`  • 预计GPU负载: ${analysis.stats.estimatedGpuLoad}%`);
  lines.push(`  • 预计内存使用: ${(analysis.stats.estimatedMemoryUsage / 1024).toFixed(1)} GB`);
  lines.push("");

  // 瓶颈
  if (analysis.bottlenecks.length > 0) {
    lines.push("⚠️  性能瓶颈:");
    for (const bottleneck of analysis.bottlenecks) {
      const icon = bottleneck.severity > 70 ? "🔴" : bottleneck.severity > 50 ? "🟡" : "🔵";
      lines.push(`  ${icon} [${bottleneck.type.toUpperCase()}] ${bottleneck.description}`);
    }
    lines.push("");
  }

  // 建议
  if (analysis.recommendations.length > 0) {
    lines.push("💡 优化建议:");
    for (const rec of analysis.recommendations) {
      const priorityIcon = rec.priority === "high" ? "🔥" : rec.priority === "medium" ? "⭐" : "💭";
      const difficultyLabel = { easy: "简单", medium: "中等", hard: "困难" }[rec.difficulty];
      lines.push(`  ${priorityIcon} ${rec.description}`);
      lines.push(`     预期提升: ${rec.expectedGain} | 难度: ${difficultyLabel}`);
    }
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n");
}

/** 格式化时长 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(0)} 秒`;
  } else if (seconds < 3600) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min} 分 ${sec.toFixed(0)} 秒`;
  } else {
    const hour = Math.floor(seconds / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    return `${hour} 小时 ${min} 分`;
  }
}
