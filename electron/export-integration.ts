/**
 * 导出性能优化集成层
 *
 * 提供透明的性能优化，自动选择最佳导出策略：
 * - 小项目：使用标准单进程导出
 * - 大项目：使用分块并行导出
 * - 支持平滑降级
 */

import { type Project } from "../shared/model";
import type { ExportSettings } from "../shared/export-settings";
import { resolvedExportSettings } from "../shared/export-settings";
import { exportVideo as originalExportVideo } from "./export";
import {
  ChunkedExportManager,
  shouldUseChunkedExport,
} from "./export-optimizer";

/** 优化的导出选项 */
interface OptimizedExportOptions {
  /** 强制使用特定策略 */
  strategy?: "auto" | "standard" | "chunked";
  /** 分块大小（秒） */
  chunkDuration?: number;
  /** 最大并行任务数 */
  maxParallel?: number;
  /** 启用调试日志 */
  debug?: boolean;
}

/** 导出进度信息 */
export interface ExportProgress {
  /** 总体进度百分比 (0-100) */
  percent: number;
  /** 当前阶段描述 */
  stage: string;
  /** 已完成的分块数（如果使用分块导出） */
  completedChunks?: number;
  /** 总分块数（如果使用分块导出） */
  totalChunks?: number;
  /** 估计剩余时间（毫秒） */
  estimatedTimeRemaining?: number;
  /** 使用的策略 */
  strategy: "standard" | "chunked";
}

/**
 * 优化的视频导出函数
 *
 * 自动选择最佳导出策略并提供详细的进度信息
 */
export async function exportVideoOptimized(
  project: Project,
  target: string,
  workDir: string,
  rubberband: boolean,
  signal: AbortSignal,
  progress: (info: ExportProgress) => void,
  resourcesPath?: string,
  options?: OptimizedExportOptions,
): Promise<void> {
  const settings = resolvedExportSettings(project.exportSettings);
  const debug = options?.debug ?? false;

  // 决定使用哪种策略
  let strategy: "standard" | "chunked";

  if (options?.strategy === "chunked") {
    strategy = "chunked";
  } else if (options?.strategy === "standard") {
    strategy = "standard";
  } else {
    // 自动选择
    strategy = shouldUseChunkedExport(project, settings) ? "chunked" : "standard";
  }

  if (debug) {
    console.log(`[导出优化] 选择策略: ${strategy}`);
    console.log(`[导出优化] 项目时长: ${project.clips.reduce((sum, c) => Math.max(sum, c.start + c.duration), 0)}秒`);
    console.log(`[导出优化] 片段数量: ${project.clips.length}`);
  }

  if (strategy === "chunked") {
    try {
      return await exportWithChunking(
        project,
        target,
        workDir,
        rubberband,
        signal,
        progress,
        resourcesPath,
        options,
        debug,
      );
    } catch (error) {
      if (debug) {
        console.warn(`[导出优化] 分块导出失败，降级到标准导出:`, error);
      }
      // 降级到标准导出
      strategy = "standard";
    }
  }

  // 标准导出
  return exportWithStandard(
    project,
    target,
    workDir,
    rubberband,
    signal,
    progress,
    resourcesPath,
    debug,
  );
}

/** 使用分块策略导出 */
async function exportWithChunking(
  project: Project,
  target: string,
  workDir: string,
  rubberband: boolean,
  signal: AbortSignal,
  progress: (info: ExportProgress) => void,
  resourcesPath: string | undefined,
  options: OptimizedExportOptions | undefined,
  debug: boolean,
): Promise<void> {
  const settings = resolvedExportSettings(project.exportSettings);
  const manager = new ChunkedExportManager(project, settings, {
    chunkDuration: options?.chunkDuration,
    maxParallelChunks: options?.maxParallel,
  });

  const startTime = Date.now();

  await manager.export(
    target,
    workDir,
    resourcesPath,
    signal,
    (percent, stats) => {
      progress({
        percent,
        stage: stats.completedChunks < stats.totalChunks
          ? `渲染分块 ${stats.completedChunks + 1}/${stats.totalChunks}`
          : "合并视频片段",
        completedChunks: stats.completedChunks,
        totalChunks: stats.totalChunks,
        estimatedTimeRemaining: stats.estimatedTimeRemaining,
        strategy: "chunked",
      });

      if (debug && stats.completedChunks > 0) {
        const elapsed = Date.now() - startTime;
        const avgTimePerChunk = elapsed / stats.completedChunks;
        console.log(
          `[导出优化] 进度: ${stats.completedChunks}/${stats.totalChunks} 分块, ` +
          `平均每块: ${(avgTimePerChunk / 1000).toFixed(1)}秒, ` +
          `缓存命中: ${stats.cachedChunks}`,
        );
      }
    },
  );

  if (debug) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = manager.getStats();
    console.log(
      `[导出优化] 完成! 总耗时: ${totalTime}秒, ` +
      `总分块: ${stats.totalChunks}, ` +
      `缓存命中: ${stats.cachedChunks}, ` +
      `失败: ${stats.failedChunks}`,
    );
  }
}

/** 使用标准策略导出 */
async function exportWithStandard(
  project: Project,
  target: string,
  workDir: string,
  rubberband: boolean,
  signal: AbortSignal,
  progress: (info: ExportProgress) => void,
  resourcesPath: string | undefined,
  debug: boolean,
): Promise<void> {
  const startTime = Date.now();

  await originalExportVideo(
    project,
    target,
    workDir,
    rubberband,
    signal,
    (percent) => {
      progress({
        percent,
        stage: percent < 99 ? "渲染视频" : "最终处理",
        strategy: "standard",
        estimatedTimeRemaining: percent > 0
          ? ((Date.now() - startTime) / percent) * (100 - percent)
          : undefined,
      });

      if (debug && percent % 10 === 0) {
        console.log(`[导出优化] 标准导出进度: ${percent.toFixed(1)}%`);
      }
    },
    resourcesPath,
  );

  if (debug) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[导出优化] 标准导出完成! 总耗时: ${totalTime}秒`);
  }
}

/**
 * 预估导出时间
 *
 * 基于项目复杂度和硬件性能估算导出时间
 */
export function estimateExportTime(project: Project): {
  min: number; // 秒
  max: number; // 秒
  strategy: "standard" | "chunked";
} {
  const settings = resolvedExportSettings(project.exportSettings);
  const duration = project.clips.reduce((max, clip) =>
    Math.max(max, clip.start + clip.duration), 0
  );

  const clipCount = project.clips.length;
  const hasEffects = project.clips.some(c =>
    c.visualEffects && Object.keys(c.visualEffects).length > 0
  );
  const hasAnimations = project.clips.some(c =>
    c.keyframes && c.keyframes.length > 3
  );

  // 基础速率：每秒视频需要的渲染时间
  let baseRate = 0.5; // 简单项目

  if (hasEffects) baseRate *= 1.5;
  if (hasAnimations) baseRate *= 1.3;
  if (clipCount > 50) baseRate *= 1.2;
  if (settings.quality === "high") baseRate *= 1.4;

  const strategy = shouldUseChunkedExport(project, settings) ? "chunked" : "standard";

  // 分块导出可以利用多核，减少总时间
  const parallelSpeedup = strategy === "chunked" ? 0.4 : 1;

  const estimatedTime = duration * baseRate * parallelSpeedup;

  return {
    min: Math.max(10, estimatedTime * 0.7),
    max: estimatedTime * 1.5,
    strategy,
  };
}

/**
 * 获取导出性能建议
 */
export function getExportPerformanceAdvice(project: Project): string[] {
  const advice: string[] = [];
  const settings = resolvedExportSettings(project.exportSettings);
  const duration = project.clips.reduce((max, clip) =>
    Math.max(max, clip.start + clip.duration), 0
  );

  // 检查是否可以使用分块导出
  if (shouldUseChunkedExport(project, settings)) {
    advice.push("✨ 该项目将使用并行分块导出，速度提升 2-3 倍");
  }

  // 检查硬件加速
  if (settings.encoder !== "software") {
    advice.push("🚀 已启用硬件编码加速 (GPU)");
  } else if (process.platform === "win32" || process.platform === "darwin") {
    advice.push("💡 建议启用硬件编码以提升 3-5 倍速度");
  }

  // 检查质量设置
  if (settings.quality === "high" && duration > 300) {
    advice.push("⚠️ 长视频使用高质量设置会显著增加导出时间");
    advice.push("💡 考虑使用中等质量，视觉差异很小但速度快 40%");
  }

  // 检查复杂效果
  const complexClips = project.clips.filter(c =>
    (c.visualEffects && Object.keys(c.visualEffects).length > 2) ||
    (c.keyframes && c.keyframes.length > 10)
  );
  if (complexClips.length > 5) {
    advice.push(`⚠️ 检测到 ${complexClips.length} 个复杂效果片段，可能影响速度`);
  }

  // 检查分辨率
  const resolution = settings.resolution;
  if (resolution > 1 && duration > 600) {
    advice.push("💡 超过 10 分钟的视频，考虑降低分辨率以加快导出");
  }

  return advice;
}
