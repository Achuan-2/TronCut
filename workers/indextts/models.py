"""Pinned IndexTTS 2.5 checkpoints and auxiliary models; no mirror fallback offline."""
import argparse
import json
from pathlib import Path

MODEL_REPO = "IndexTeam/IndexTTS-2.5"
MODEL_REVISION = "c39ce5ba981572cb187443877ff559dfb246ce63"
MAIN_FILES = [
    "config.yaml", "gpt.pth", "s2mel.pth", "codec.pth", "feat1.pt", "feat2.pt",
    "wav2vec2bert_stats.pt", "multilingual_zh_ja_yue_char_del.tiktoken", "LICENSE",
]
AUXILIARY = [
    ("facebook/w2v-bert-2.0", "da985ba0987f70aaeb84a80f2851cfac8c697a7b",
     "hf_cache/w2v-bert-2.0", ["config.json", "preprocessor_config.json", "model.safetensors"]),
    ("funasr/campplus", "e4b6ede7ce16997aff4ae69fbca1f0175e2afede",
     "hf_cache", ["campplus_cn_common.bin"]),
    ("nvidia/bigvgan_v2_22khz_80band_256x", "633ff708ed5b74903e86ff1298cf4a98e921c513",
     "hf_cache/bigvgan", ["config.json", "bigvgan_generator.pt", "LICENSE"]),
]


def required_files(root: Path) -> list[Path]:
    return [root / file for file in MAIN_FILES] + [
        root / folder / file for _, _, folder, files in AUXILIARY for file in files
    ]


def prepare_models(root: Path, offline: bool, progress=lambda percent, label: None):
    from huggingface_hub import snapshot_download

    groups = [(MODEL_REPO, MODEL_REVISION, "", MAIN_FILES), *AUXILIARY]
    for index, (repo, revision, folder, files) in enumerate(groups):
        target = root / folder
        missing = [file for file in files if not (target / file).is_file() or (target / file).stat().st_size == 0]
        if missing:
            if offline:
                raise ValueError(f"离线模型不完整：{repo} 缺少 {', '.join(missing)}，请先联网准备 IndexTTS")
            progress(3 + index * 2, f"正在下载 {repo}（首次需下载数 GB 模型）")
            snapshot_download(repo_id=repo, revision=revision, local_dir=str(target),
                              allow_patterns=missing, max_workers=3)
    root.mkdir(parents=True, exist_ok=True)
    (root / "troncut-models.json").write_text(json.dumps({
        "model": MODEL_REPO, "revision": MODEL_REVISION,
        "auxiliary": [{"repo": repo, "revision": revision} for repo, revision, _, _ in AUXILIARY],
    }, ensure_ascii=False, indent=2), encoding="utf8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    prepare_models(Path(args.model_dir).resolve(), args.offline,
                   lambda percent, label: print(label, flush=True))
    print("IndexTTS 2.5 主模型与辅助模型已准备完成", flush=True)
