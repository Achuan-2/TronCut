param(
    [ValidateSet('voices', 'synthesize')][string]$Action = 'voices',
    [string]$Request,
    [string]$Output
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$utf8 = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$pcm = $null
$writer = $null
$pcmPath = $null
try {
    # Explicitly Online/Edge registrations are not offline voices. Custom local
    # providers remain available, including the user's registered Microsoft Yunxi.
    $voices = @($synth.GetInstalledVoices() | Where-Object {
        $_.Enabled -and $_.VoiceInfo.Name -notmatch 'Online' -and $_.VoiceInfo.Id -notmatch '^Edge-'
    } | ForEach-Object {
        $v = $_.VoiceInfo
        [PSCustomObject]@{id=$v.Id; name=$v.Name; language=$v.Culture.Name; gender=$v.Gender.ToString()}
    })
    if ($Action -eq 'voices') {
        [Console]::WriteLine((ConvertTo-Json -InputObject $voices -Compress))
        return
    }
    $options = [IO.File]::ReadAllText($Request, $utf8) | ConvertFrom-Json
    if (-not $voices.Count) { throw 'No installed Windows offline speech voices are available.' }
    if ($options.voice -eq 'auto') {
        $voice = $voices | Sort-Object @{Expression={
            if ($_.name -match 'Yunxi') { 0 }
            elseif ($_.language -like 'zh*' -and $_.gender -eq 'Male') { 1 }
            elseif ($_.language -like 'zh*') { 2 } else { 3 }
        }}, name | Select-Object -First 1
    } else {
        $voice = $voices | Where-Object id -eq $options.voice | Select-Object -First 1
    }
    if (-not $voice) { throw 'The selected Windows voice is unavailable. Refresh the installed voices.' }
    $synth.SelectVoice($voice.name)
    $synth.Rate = 0 # Playback speed is applied once by TronCut's FFmpeg conversion.
    $synth.Volume = 100
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $pcmPath = $Output + '.pcm'
    $pcm = [IO.File]::Open($pcmPath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    $synth.SetOutputToAudioStream($pcm, $format)
    $limit = if ($options.captionChars) { [int]$options.captionChars } else { 100 }
    $chunks = New-Object 'System.Collections.Generic.List[string]'
    foreach ($match in [regex]::Matches($options.text, '[^\u3002\uff01\uff1f!?\uff1b;\n]+[\u3002\uff01\uff1f!?\uff1b;\n]*|[\u3002\uff01\uff1f!?\uff1b;\n]+')) {
        $part = $match.Value
        while ($part.Length -gt $limit) {
            $cut = $limit
            for ($i = $limit - 1; $i -ge [int]($limit / 2); $i--) {
                if ([int][char]$part[$i] -in @(0xFF0C, 0x3001, 44, 32)) { $cut = $i + 1; break }
            }
            # Keep a short remainder with enough context for installed providers
            # that produce no audio for isolated one- or two-character fragments.
            if ($part.Length - $cut -lt 8) { $cut = [int][Math]::Ceiling($part.Length / 2.0) }
            if ($cut -lt $part.Length -and [char]::IsHighSurrogate($part[$cut - 1])) { $cut-- }
            $chunks.Add($part.Substring(0, $cut))
            $part = $part.Substring($cut)
        }
        if ($part.Trim().Length) { $chunks.Add($part) }
    }
    $segments = New-Object 'System.Collections.Generic.List[object]'
    $clock = [Diagnostics.Stopwatch]::StartNew()
    for ($index = 0; $index -lt $chunks.Count; $index++) {
        $before = $pcm.Length
        [Console]::WriteLine('TRONCUT_PROGRESS ' + (@{percent=(15 + 75 * $index / $chunks.Count); label=('Windows TTS: ' + $voice.name + ' (' + ($index + 1) + '/' + $chunks.Count + ')')} | ConvertTo-Json -Compress))
        $synth.Speak($chunks[$index])
        $pcm.Flush()
        $after = $pcm.Length
        if ($after -le $before) { throw 'Windows speech provider returned empty audio.' }
        $segments.Add(@{start=($before / 96000.0); end=($after / 96000.0); text=$chunks[$index]})
    }
    $synth.SetOutputToNull()
    $pcm.Dispose()
    $pcm = $null
    $size = (Get-Item -LiteralPath $pcmPath).Length
    if ($size -le 0) { throw 'Windows speech provider returned empty audio.' }
    $writer = New-Object IO.BinaryWriter([IO.File]::Create($Output))
    $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
    $writer.Write([uint32]($size + 36))
    $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
    $writer.Write([uint32]16)
    $writer.Write([uint16]1)
    $writer.Write([uint16]1)
    $writer.Write([uint32]48000)
    $writer.Write([uint32]96000)
    $writer.Write([uint16]2)
    $writer.Write([uint16]16)
    $writer.Write([Text.Encoding]::ASCII.GetBytes('data'))
    $writer.Write([uint32]$size)
    $source = [IO.File]::OpenRead($pcmPath)
    try { $source.CopyTo($writer.BaseStream) } finally { $source.Dispose() }
    $writer.Dispose()
    $writer = $null
    $metadata = @{model='windows-sapi'; device='cpu'; sampleRate=48000; duration=($size / 96000.0); loadSeconds=0; generationSeconds=$clock.Elapsed.TotalSeconds; voiceId=$voice.id; voiceName=$voice.name; segments=@($segments.ToArray())}
    [IO.File]::WriteAllText($Output + '.json', ($metadata | ConvertTo-Json -Depth 5), $utf8)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    $synth.Dispose()
    if ($pcm) { $pcm.Dispose() }
    if ($writer) { $writer.Dispose() }
    if ($pcmPath -and [IO.File]::Exists($pcmPath)) { [IO.File]::Delete($pcmPath) }
}
