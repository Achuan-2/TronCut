// Bundled from Recordly @ 535d1cf (AGPL-3.0). Original files are kept unchanged.
export const recordlyBackgrounds = {
  bluerays: { name: "Bluerays", file: "bluerays.jpeg", animated: false },
  cherrypop: { name: "Cherrypop", file: "cherrypop.jpg", animated: false },
  cityscape: { name: "Cityscape", file: "cityscape.jpg", animated: false },
  "energy-17": { name: "Energy 17", file: "energy-17.jpg", animated: false },
  "energy-19": { name: "Energy 19", file: "energy-19.jpg", animated: false },
  farmvalley: { name: "Farmvalley", file: "farmvalley.jpg", animated: false },
  "glassmorphism-3": {
    name: "Glassmorphism 3",
    file: "glassmorphism-3.jpg",
    animated: false,
  },
  "glassmorphism-4": {
    name: "Glassmorphism 4",
    file: "glassmorphism-4.jpg",
    animated: false,
  },
  "ipad-17-dark": {
    name: "Ipad 17 Dark",
    file: "ipad-17-dark.jpg",
    animated: false,
  },
  "ipad-17-light": {
    name: "Ipad 17 Light",
    file: "ipad-17-light.jpg",
    animated: false,
  },
  "iridescent-9": {
    name: "Iridescent 9",
    file: "iridescent-9.jpg",
    animated: false,
  },
  lemonade: { name: "Lemonade", file: "lemonade.jpeg", animated: false },
  levels: { name: "Levels", file: "levels.jpg", animated: false },
  luisdelrio: { name: "Luisdelrio", file: "luisdelrio.jpg", animated: false },
  "midnight-8": { name: "Midnight 8", file: "midnight-8.jpg", animated: false },
  mountaintrees: {
    name: "Mountaintrees",
    file: "mountaintrees.jpg",
    animated: false,
  },
  "sequoia-blue-orange": {
    name: "Sequoia Blue Orange",
    file: "sequoia-blue-orange.jpg",
    animated: false,
  },
  "sequoia-blue": {
    name: "Sequoia Blue",
    file: "sequoia-blue.jpg",
    animated: false,
  },
  "sonoma-clouds": {
    name: "Sonoma Clouds",
    file: "sonoma-clouds.jpg",
    animated: false,
  },
  "sonoma-dark": {
    name: "Sonoma Dark",
    file: "sonoma-dark.jpg",
    animated: false,
  },
  "sonoma-evening": {
    name: "Sonoma Evening",
    file: "sonoma-evening.jpg",
    animated: false,
  },
  "sonoma-horizon": {
    name: "Sonoma Horizon",
    file: "sonoma-horizon.jpg",
    animated: false,
  },
  "sonoma-light": {
    name: "Sonoma Light",
    file: "sonoma-light.jpg",
    animated: false,
  },
  "tahoe-dark": { name: "Tahoe Dark", file: "tahoe-dark.jpg", animated: false },
  "tahoe-light": {
    name: "Tahoe Light",
    file: "tahoe-light.jpg",
    animated: false,
  },
  "ventura-dark": {
    name: "Ventura Dark",
    file: "ventura-dark.jpg",
    animated: false,
  },
  ventura: { name: "Ventura", file: "ventura.jpg", animated: false },
  wallpaper1: { name: "Wallpaper1", file: "wallpaper1.jpg", animated: false },
  wallpaper10: {
    name: "Wallpaper10",
    file: "wallpaper10.jpg",
    animated: false,
  },
  wallpaper11: {
    name: "Wallpaper11",
    file: "wallpaper11.jpg",
    animated: false,
  },
  wallpaper12: {
    name: "Wallpaper12",
    file: "wallpaper12.jpg",
    animated: false,
  },
  wallpaper13: {
    name: "Wallpaper13",
    file: "wallpaper13.jpg",
    animated: false,
  },
  wallpaper15: {
    name: "Wallpaper15",
    file: "wallpaper15.jpg",
    animated: false,
  },
  wallpaper2: { name: "Wallpaper2", file: "wallpaper2.jpg", animated: false },
  wallpaper3: { name: "Wallpaper3", file: "wallpaper3.jpg", animated: false },
  wallpaper4: { name: "Wallpaper4", file: "wallpaper4.jpg", animated: false },
  wallpaper7: { name: "Wallpaper7", file: "wallpaper7.jpg", animated: false },
  wallpaper9: { name: "Wallpaper9", file: "wallpaper9.jpg", animated: false },
  wispysky: { name: "Wispysky", file: "wispysky.mp4", animated: true },
} as const;
export function recordingWallpaperUrl(file: string) {
  return new URL(`recording/wallpapers/${file}`, document.baseURI).href;
}
