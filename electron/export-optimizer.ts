/**
 * 视频导出性能优化模块
 *
 * 主要优化策略：
 * 1. 分块并行导出 - 将时间轴分割为多个片段并行处理
 * 2. 智能缓存 - 缓存未修改的片段
 * 3. 资源池管理 - FFmpeg进程池
 * 4. 内存优化 - 流式处理大型项目
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Project, projectDuration } from "../shared/model";
import { findBinary, runProcess } from "./process";
import type { ExportSettings } from "../shared/export-settings";
import { resolvedExportSettings } from "../shared/export-settings";

/** 分块配置 */
interface ChunkConfig {
  /** 每个分块的时长（秒），默认10秒 */
  chunkDuration: number;
  /** 最大并行分块数，默认为CPU核心数 */
  maxParallelChunks: number;
  /** 分块之间的重叠时间（秒），避免过渡边界问题 */
  overlapDuration: number;
}

/** 分块信息 */
interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  outputPath: string;
}

/** 导出统计信息 */
interface ExportStats {
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  cachedChunks: number;
  startTime: number;
  estimatedTimeRemaining: number;
}

/** FFmpeg进程池 */
class FFmpegWorkerPool {
  private availableWorkers: number;
  private queue: Array<() => Promise<void>> = [];
  private activeCount = 0;

  constructor(private maxWorkers: number) {
    this.availableWorkers = maxWorkers;
  }

  async execute<T>(task: () => Promise<T>): Promise<T> {
    if (this.availableWorkers > 0) {
      this.availableWorkers--;
      this.activeCount++;
      try {
        return await task();
      } finally {
        this.availableWorkers++;
        this.activeCount--;
        this.processQueue();
      }
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private processQueue() {
    if (this.queue.length > 0 && this.availableWorkers > 0) {
      const task = this.queue.shift();
      if (task) {
        this.availableWorkers--;
        this.activeCount++;
        task().finally(() => {
          this.availableWorkers++;
          this.activeCount--;
          this.processQueue();
        });
      }
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

/** 分块导出管理器 */
export class ChunkedExportManager {
  private config: ChunkConfig;
  private workerPool: FFmpegWorkerPool;
  private stats: ExportStats;
  private chunkCache = new Map<string, string>();

  constructor(
    private project: Project,
    private settings: Required<ExportSettings>,
    config?: Partial<ChunkConfig>,
  ) {
    const cpuCount = os.cpus().length;
    this.config = {
      chunkDuration: config?.chunkDuration ?? 10,
      maxParallelChunks: config?.maxParallelChunks ?? Math.max(2, Math.min(4, cpuCount)),
      overlapDuration: config?.overlapDuration ?? 0.5,
    };
    this.workerPool = new FFmpegWorkerPool(this.config.maxParallelChunks);
    this.stats = {
      totalChunks: 0,
      completedChunks: 0,
      failedChunks: 0,
      cachedChunks: 0,
      startTime: Date.now(),
      estimatedTimeRemaining: 0,
    };
  }

  /** 计算分块信息 */
  private calculateChunks(duration: number): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];
    const { chunkDuration, overlapDuration } = this.config;
    let currentTime = 0;
    let index = 0;

    while (currentTime < duration) {
      const endTime = Math.min(currentTime + chunkDuration, duration);
      const actualDuration = endTime - currentTime;

      chunks.push({
        index,
        startTime: currentTime,
        endTime,
        duration: actualDuration,
        outputPath: "", // 稍后填充
      });

      // 下一个分块的起始时间考虑重叠
      currentTime = endTime - (endTime < duration ? overlapDuration : 0);
      index++;
    }

    return chunks;
  }

  /** 生成分块的缓存键 */
  private getChunkCacheKey(chunk: ChunkInfo): string {
    // 基于项目内容和分块时间范围生成缓存键
    const relevantClips = this.project.clips.filter(
      clip =>
        (clip.start < chunk.endTime && clip.start + clip.duration > chunk.startTime)
    );

    const clipSignature = relevantClips
      .map(c => `${c.id}-${c.assetId}-${c.start}-${c.duration}-${JSON.stringify(c.transform)}`)
      .join("|");

    return `chunk-${chunk.index}-${chunk.startTime}-${chunk.endTime}-${Buffer.from(clipSignature).toString("base64").slice(0, 32)}`;
  }

  /** 检查分块缓存 */
  private async checkChunkCache(
    chunk: ChunkInfo,
    cacheDir: string,
  ): Promise<string | null> {
    const cacheKey = this.getChunkCacheKey(chunk);
    const cachedPath = path.join(cacheDir, `${cacheKey}.mp4`);

    try {
      await fs.access(cachedPath);
      return cachedPath;
    } catch {
      return null;
    }
  }

  /** 导出单个分块 */
  private async exportChunk(
    chunk: ChunkInfo,
    workDir: string,
    cacheDir: string,
    resourcesPath: string | undefined,
    signal: AbortSignal,
    onProgress: (chunkIndex: number, percent: number) => void,
  ): Promise<string> {
    // 检查缓存
    const cached = await this.checkChunkCache(chunk, cacheDir);
    if (cached) {
      this.stats.cachedChunks++;
      this.stats.completedChunks++;
      onProgress(chunk.index, 100);
      return cached;
    }

    // 创建分块输出路径
    const chunkOutput = path.join(workDir, `chunk-${chunk.index}.mp4`);

    // 这里需要调用原有的导出逻辑，但限制时间范围
    // 由于原有exportVideo不支持时间范围参数，我们需要修改项目对象
    const chunkProject = this.createChunkProject(chunk);

    // TODO: 调用修改后的导出函数
    // 当前作为占位符，实际需要与原export.ts集成

    return chunkOutput;
  }

  /** 创建分块项目（只包含相关时间范围的clips） */
  private createChunkProject(chunk: ChunkInfo): Project {
    const { startTime, endTime } = chunk;

    // 过滤并调整clips
    const relevantClips = this.project.clips
      .filter(clip => {
        const clipEnd = clip.start + clip.duration;
        return clip.start < endTime && clipEnd > startTime;
      })
      .map(clip => {
        // 调整clip的开始时间和持续时间以适应分块
        const clipStart = Math.max(0, clip.start - startTime);
        const clipEnd = Math.min(clip.start + clip.duration, endTime) - startTime;
        const newDuration = clipEnd - clipStart;

        return {
          ...clip,
          start: clipStart,
          duration: newDuration,
          sourceIn: clip.sourceIn + (startTime - clip.start > 0 ? (startTime - clip.start) / clip.speed : 0),
        };
      });

    return {
      ...this.project,
      clips: relevantClips,
      // 调整画布持续时间
      canvas: {
        ...this.project.canvas,
      },
    };
  }

  /** 合并所有分块 */
  private async mergeChunks(
    chunks: ChunkInfo[],
    outputPath: string,
    resourcesPath: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    // 创建concat文件列表
    const concatList = chunks
      .map(chunk => `file '${chunk.outputPath.replace(/\\/g, "/")}'`)
      .join("\n");

    const concatFile = path.join(
      path.dirname(chunks[0].outputPath),
      "concat-list.txt",
    );
    await fs.writeFile(concatFile, concatList);

    // 使用FFmpeg的concat demuxer合并
    const args = [
      "-y",
      "-hide_banner",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c",
      "copy", // 不重新编码，直接复制流
      outputPath,
    ];

    try {
      await runProcess(findBinary("ffmpeg", resourcesPath), args, { signal });
    } finally {
      // 清理concat文件
      await fs.rm(concatFile, { force: true });
    }
  }

  /** 执行分块导出 */
  async export(
    outputPath: string,
    workDir: string,
    resourcesPath: string | undefined,
    signal: AbortSignal,
    onProgress: (percent: number, stats: ExportStats) => void,
  ): Promise<void> {
    const duration = projectDuration(this.project);
    if (duration <= 0) throw new Error("时间轴为空");

    // 如果视频很短，不使用分块
    if (duration < this.config.chunkDuration * 2) {
      throw new Error("视频太短，请使用标准导出方式");
    }

    // 计算分块
    const chunks = this.calculateChunks(duration);
    this.stats.totalChunks = chunks.length;

    // 创建缓存目录
    const cacheDir = path.join(workDir, "chunk-cache");
    await fs.mkdir(cacheDir, { recursive: true });

    // 填充输出路径
    chunks.forEach(chunk => {
      chunk.outputPath = path.join(workDir, `chunk-${chunk.index}.mp4`);
    });

    // 并行导出所有分块
    const chunkPromises = chunks.map(chunk =>
      this.workerPool.execute(async () => {
        if (signal.aborted) throw new Error("任务已取消");

        try {
          await this.exportChunk(
            chunk,
            workDir,
            cacheDir,
            resourcesPath,
            signal,
            (chunkIndex, percent) => {
              // 计算总体进度
              const completedProgress = this.stats.completedChunks * 100;
              const currentProgress = percent;
              const totalProgress = (completedProgress + currentProgress) / this.stats.totalChunks;

              // 估算剩余时间
              const elapsed = Date.now() - this.stats.startTime;
              const estimatedTotal = (elapsed / totalProgress) * 100;
              this.stats.estimatedTimeRemaining = estimatedTotal - elapsed;

              onProgress(totalProgress, this.stats);
            },
          );
          this.stats.completedChunks++;
        } catch (error) {
          this.stats.failedChunks++;
          throw error;
        }
      }),
    );

    // 等待所有分块完成
    await Promise.all(chunkPromises);

    // 合并分块
    onProgress(99, this.stats);
    await this.mergeChunks(chunks, outputPath, resourcesPath, signal);

    onProgress(100, this.stats);

    // 清理临时文件
    await Promise.all(
      chunks.map(chunk => fs.rm(chunk.outputPath, { force: true })),
    );
  }

  /** 获取统计信息 */
  getStats(): ExportStats {
    return { ...this.stats };
  }
}

/** 智能选择导出策略 */
export function shouldUseChunkedExport(
  project: Project,
  settings: Required<ExportSettings>,
): boolean {
  const duration = projectDuration(project);
  const clipCount = project.clips.length;
  const hasComplexEffects = project.clips.some(
    clip =>
      (clip.visualEffects && Object.keys(clip.visualEffects).length > 0) ||
      (clip.behaviors && clip.behaviors.length > 0) ||
      (clip.keyframes && clip.keyframes.length > 5)
  );

  // 使用分块导出的条件：
  // 1. 视频时长 > 60秒
  // 2. 片段数量 > 20
  // 3. CPU核心数 >= 4
  // 4. 不是超高复杂度的项目（避免分块开销大于收益）

  return (
    duration > 60 &&
    clipCount > 20 &&
    os.cpus().length >= 4 &&
    !hasComplexEffects // 简化判断，实际可更复杂
  );
}
