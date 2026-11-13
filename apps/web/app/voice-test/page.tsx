"use client";

/**
 * /voice-test — a standalone, backend-free browser audio I/O lab.
 *
 * Purpose: isolate the raw microphone → speaker path from the whole
 * prep/live/post pipeline, so we can answer questions the interview screen
 * can't:
 *
 *   1. FEEDBACK (回灌): does the mic bleed back through the speaker and
 *      howl? Toggle live monitor ON with speakers, then ON with headphones —
 *      if it only howls on speakers, the noise is acoustic feedback and the
 *      half-duplex gate direction is correct. If it never howls here, the
 *      noise we hear in the interview is NOT the mic path.
 *   2. BROWSER AEC: what constraints did the browser ACTUALLY apply to the
 *      capture track (echoCancellation / noiseSuppression / autoGainControl)?
 *      getSettings() reports the truth, not what we requested.
 *   3. I/O FIDELITY: record a few seconds and play it back — verifies the
 *      capture quality and the speaker output independent of any agent.
 *
 * This page touches NO LiveKit, NO server, NO interview code. It only uses
 * getUserMedia + the Web Audio API.
 */

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface AudioTrackSettingsSummary {
  deviceId?: string;
  groupId?: string;
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export default function VoiceTestPage() {
  const [micReady, setMicReady] = React.useState(false);
  const [monitorOn, setMonitorOn] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [recording, setRecording] = React.useState(false);
  const [clipUrl, setClipUrl] = React.useState<string | null>(null);
  const [actual, setActual] = React.useState<AudioTrackSettingsSummary | null>(
    null,
  );
  const [ctxRate, setCtxRate] = React.useState<number | null>(null);
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = React.useState<string>("");
  const [sinkId, setSinkId] = React.useState<string>("");
  const [log, setLog] = React.useState<string[]>([]);

  // Audio graph refs — kept out of React state so toggles never re-negotiate.
  const ctxRef = React.useRef<AudioContext | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const monitorGainRef = React.useRef<GainNode | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const audioElRef = React.useRef<HTMLAudioElement>(null);

  function note(line: string) {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} · ${line}`]);
  }

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
      const mics = list.filter((d) => d.kind === "audioinput");
      setMicId((cur) => cur || mics[0]?.deviceId || "");
    } catch (e) {
      note(`枚举设备失败：${String(e)}`);
    }
  }

  function startMeter() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 3));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  async function startMic() {
    stopAll();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: micId ? { exact: micId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume();
      ctxRef.current = ctx;
      setCtxRate(ctx.sampleRate);

      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const monitorGain = ctx.createGain();
      monitorGain.gain.value = 0; // monitor OFF by default — no accidental howl
      src.connect(analyser);
      src.connect(monitorGain);
      monitorGain.connect(ctx.destination);
      analyserRef.current = analyser;
      monitorGainRef.current = monitorGain;

      const track = stream.getAudioTracks()[0];
      if (!track) {
        note("getUserMedia 未返回音频轨道");
        return;
      }
      setActual(track.getSettings() as AudioTrackSettingsSummary);
      startMeter();
      setMicReady(true);
      note(
        `麦克风已启动（采样率 ${ctx.sampleRate}Hz，track ` +
          `${track.label || track.getSettings().deviceId?.slice(0, 8) || "未命名"}）`,
      );
      await refreshDevices();
    } catch (e) {
      note(`麦克风启动失败：${String(e)}`);
    }
  }

  function toggleMonitor() {
    const gain = monitorGainRef.current;
    const ctx = ctxRef.current;
    if (!gain || !ctx) return;
    const next = gain.gain.value > 0 ? 0 : 1;
    gain.gain.setTargetAtTime(next, ctx.currentTime, 0.01);
    setMonitorOn(next === 1);
    note(
      next === 1
        ? "监听已开启：麦克风实时接到扬声器/耳机——外放若啸叫即回灌"
        : "监听已关闭",
    );
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      const url = URL.createObjectURL(blob);
      setClipUrl(url);
      note(`录音完成（${(blob.size / 1024).toFixed(0)} KB，${rec.mimeType}）`);
    };
    rec.start();
    recorderRef.current = rec;
    setRecording(true);
    setClipUrl(null);
    note("开始录音…");
  }

  function stopRecording() {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    setRecording(false);
  }

  function playTone() {
    const ctx = ctxRef.current;
    if (!ctx) {
      note("先启动麦克风以建立音频上下文");
      return;
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 440;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
    note("播放 440Hz 参考音 0.5s（测扬声器输出）");
  }

  async function routeClipToSink() {
    const el = audioElRef.current;
    if (!el || !sinkId) return;
    const anyEl = el as unknown as { setSinkId?: (id: string) => Promise<void> };
    if (typeof anyEl.setSinkId === "function") {
      try {
        await anyEl.setSinkId(sinkId);
        note("回放已切换到选定输出设备");
      } catch (e) {
        note(`切换输出设备失败：${String(e)}`);
      }
    } else {
      note("此浏览器不支持 setSinkId，回放走默认输出");
    }
  }

  function stopAll() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    monitorGainRef.current = null;
    analyserRef.current = null;
    setMicReady(false);
    setMonitorOn(false);
    setRecording(false);
    setLevel(0);
  }

  // Cleanup on unmount only.
  React.useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const inputs = devices.filter((d) => d.kind === "audioinput");

  return (
    <main className="mx-auto max-w-[760px] px-6 py-12">
      <header className="flex items-center justify-between">
        <Link href="/" className="no-underline">
          <span className="font-mono text-[10px] tracking-[0.16em] text-faint">
            DEEPINTERVIEW · LAB
          </span>
          <h1 className="serif text-2xl text-ink">语音收发测试台</h1>
        </Link>
      </header>

      <div
        className={cn(
          "mt-6 rounded-card border border-accent/40 bg-paper/80 px-4 py-3",
          "text-[13px] leading-relaxed text-ink-soft",
        )}
      >
        本页只测浏览器麦克风/扬声器本身，<b>不涉及 LiveKit、后端与面试流程</b>。
        先按下面步骤做<b>回灌判定</b>：① 用外放，开启"实时监听"——若啸叫，则杂音来自回灌；
        ② 换戴耳机再开监听——啸叫应消失。③ 看"浏览器实际应用"表格里回声消除是否为 true。
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>设备</CardTitle>
          <CardDescription>
            授权后才会显示真实设备名。切换设备需先停止再重新启动麦克风。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] text-ink-soft">
            麦克风（输入）
            <select
              className="rounded-[8px] border border-line bg-panel px-3 py-2 text-[13px] text-ink"
              value={micId}
              onChange={(e) => setMicId(e.target.value)}
            >
              <option value="">默认</option>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `麦克风 ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-soft">
            输出设备（用于录音回放）
            <select
              className="rounded-[8px] border border-line bg-panel px-3 py-2 text-[13px] text-ink"
              value={sinkId}
              onChange={(e) => {
                setSinkId(e.target.value);
              }}
            >
              <option value="">默认</option>
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `输出 ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-faint">
            提示：部分浏览器仅在授权后列出输出设备；启动麦克风后列表会自动补全。
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>采集与监听</CardTitle>
          <CardDescription>
            AudioContext 采样率 {ctxRate ?? "-"} Hz。监听默认关闭以防意外啸叫。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {!micReady ? (
              <Button onClick={startMic}>启动麦克风</Button>
            ) : (
              <Button variant="out" onClick={stopAll}>
                停止并释放
              </Button>
            )}
            <Button
              variant={monitorOn ? "ink" : "out"}
              disabled={!micReady}
              onClick={toggleMonitor}
            >
              实时监听 {monitorOn ? "ON" : "OFF"}
            </Button>
            <Button variant="out" disabled={!micReady} onClick={playTone}>
              播放参考音
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <span className="w-14 text-[12px] text-faint">输入电平</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-panel border border-line">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-75",
                  level > 0.85 ? "bg-red-500" : "bg-accent",
                )}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>

          {actual && (
            <div className="rounded-[10px] border border-line bg-paper/60 p-3">
              <p className="mb-2 text-[12px] font-medium text-ink">
                浏览器实际应用（getSettings，非我们请求的值）
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] text-ink-soft">
                <Field k="echoCancellation" v={String(actual.echoCancellation)} />
                <Field k="noiseSuppression" v={String(actual.noiseSuppression)} />
                <Field k="autoGainControl" v={String(actual.autoGainControl)} />
                <Field k="sampleRate" v={String(actual.sampleRate)} />
                <Field k="channelCount" v={String(actual.channelCount)} />
                <Field k="AudioContext" v={String(ctxRate)} />
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>录音回放（输入 → 输出）</CardTitle>
          <CardDescription>
            录一段自己的声音再回放，单独验证采集质量与扬声器输出。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {!recording ? (
              <Button disabled={!micReady} onClick={startRecording}>
                开始录音
              </Button>
            ) : (
              <Button variant="out" onClick={stopRecording}>
                停止录音
              </Button>
            )}
          </div>
          {clipUrl && (
            <audio
              ref={audioElRef}
              src={clipUrl}
              controls
              className="w-full"
              onLoadedMetadata={routeClipToSink}
            />
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>事件日志</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-52 overflow-auto rounded-[10px] bg-ink/95 p-3 font-mono text-[12px] leading-relaxed text-white/90">
            {log.length === 0 ? (
              <span className="text-white/40">（尚无操作）</span>
            ) : (
              log.map((l, i) => <div key={i}>{l}</div>)
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </>
  );
}
