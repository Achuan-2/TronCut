/** Local start time, with milliseconds to distinguish recordings in one second. */
export function recordingName(time = new Date()) {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `录屏 ${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}-${pad(time.getMinutes())}-${pad(time.getSeconds())}-${pad(time.getMilliseconds(), 3)}`;
}
