"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { Camera, CameraOff, ArrowLeft, ScanSearch, RotateCcw } from "lucide-react";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";

type InventoryItem = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
};

type Detection = {
  class: string;
  score: number;
  bbox: number[];
};

export default function KameraPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const mountedRef = useRef(true);

  const [active, setActive] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [photoTaken, setPhotoTaken] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [error, setError] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [countedQuantity, setCountedQuantity] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [inventoryError, setInventoryError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function checkAccess() {
      try {
        const db = browserClient();
        const { data: { user } } = await db.auth.getUser();
        if (cancelled) return;
        if (!user) {
          router.replace("/login");
          return;
        }

        const { data: sessionData } = await db.auth.getSession();
        if (cancelled) return;
        if (!sessionData.session) {
          router.replace("/login");
          return;
        }

        const response = await fetch("/api/items", {
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
        });
        if (cancelled) return;
        if (!response.ok) {
          setError("Du har ikke tilgang til kameraoversikten.");
          return;
        }
        const productData: unknown = await response.json();
        if (!Array.isArray(productData)) {
          setError("Kunne ikke hente varer fra lageret.");
          return;
        }
        setItems(productData.filter((item): item is InventoryItem =>
          item && typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.quantity === "number"
        ));
        setAuthorized(true);
      } catch {
        if (!cancelled) setError("Kunne ikke kontrollere tilgangen. Prøv igjen.");
      }
    }

    void checkAccess();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [router]);

  async function startCamera() {
    setError("");
    if (!authorized) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (mountedRef.current) setActive(true);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (mountedRef.current) {
        setError("Kunne ikke åpne kameraet. Kontroller kameratilgang.");
      }
    }
  }

  function clearPhoto() {
    setPhotoTaken(false);
    setDetections([]);
    setSelectedClass("");
    setSaveMessage("");
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    // Fotoğraf ve sayım ekranda kalır; kullanıcı isterse kontrol edebilir.
  }

  async function takePhotoAndCount() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!active || !video || !canvas || analyzing || video.readyState < 2 || !video.videoWidth) return;

    setAnalyzing(true);
    setError("");
    setSaveMessage("");
    setInventoryError("");

    try {
      // Fotoğrafı analizden önce dondur. Hareketli video sonucu değiştirmez.
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Kunne ikke ta bilde.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setPhotoTaken(true);
      setDetections([]);
      setSelectedClass("");
      setCountedQuantity("");

      if (!modelRef.current) modelRef.current = await cocoSsd.load();
      const predictions = await modelRef.current.detect(canvas);
      if (!mountedRef.current) return;
      const visible = predictions.filter((p) => p.score >= 0.5 && p.class !== "person");

      // Çekilmiş fotoğrafın üzerine tespit kutularını çiz.
      ctx.strokeStyle = "#22c55e";
      ctx.fillStyle = "#22c55e";
      ctx.lineWidth = 3;
      ctx.font = "18px Arial";
      visible.forEach((p) => {
        const [x, y, w, h] = p.bbox;
        ctx.strokeRect(x, y, w, h);
        ctx.fillText(`${p.class} ${Math.round(p.score * 100)}%`, x, Math.max(20, y - 8));
      });
      setDetections(visible.map((p) => ({ class: p.class, score: p.score, bbox: p.bbox })));
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : "Kunne ikke analysere bildet.");
    } finally {
      if (mountedRef.current) setAnalyzing(false);
    }
  }

  const counts = detections.reduce<Record<string, number>>((result, detection) => {
    result[detection.class] = (result[detection.class] || 0) + 1;
    return result;
  }, {});

  const selectedItem = items.find((item) => item.id === selectedItemId);
  const validCount = countedQuantity.trim() !== "" && /^\d+$/.test(countedQuantity) &&
    Number.isSafeInteger(Number(countedQuantity)) && Number(countedQuantity) <= 100000;
  const numericCount = validCount ? Number(countedQuantity) : null;
  const difference = selectedItem && numericCount !== null ? numericCount - selectedItem.quantity : null;

  function useAiCount() {
    if (!selectedClass) return;
    setCountedQuantity(String(counts[selectedClass] ?? 0));
    setSaveMessage("");
    setInventoryError("");
  }

  async function confirmCount() {
    if (!selectedItem || saving || !authorized) return;
    if (numericCount === null) {
      setInventoryError("Antallet må være et heltall mellom 0 og 100 000.");
      return;
    }
    const confirmed = window.confirm(
      `Bekrefte varetelling for ${selectedItem.name}?\n` +
      `Registrert beholdning: ${selectedItem.quantity} stk\n` +
      `Opptalt beholdning: ${numericCount} stk\n` +
      `Avvik: ${numericCount - selectedItem.quantity} stk`
    );
    if (!confirmed) return;

    setSaving(true);
    setSaveMessage("");
    setInventoryError("");
    try {
      const { data } = await browserClient().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        throw new Error("Ingen aktiv økt.");
      }
      const response = await fetch("/api/inventory-count", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          item_id: selectedItem.id,
          counted_quantity: numericCount,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Lagring mislyktes.");
      const newQuantity = result.quantity;
      if (typeof newQuantity !== "number") throw new Error("Uventet svar fra serveren.");
      setItems((previous) => previous.map((item) =>
        item.id === selectedItem.id ? { ...item, quantity: newQuantity } : item
      ));
      setSaveMessage(`Varetelling lagret: ${selectedItem.name} – ${newQuantity} stk.`);
    } catch (e) {
      setInventoryError(e instanceof Error ? e.message : "Kunne ikke lagre varetellingen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="camera-page">
      <div className="camera-container">
        <button className="camera-back" onClick={() => router.push("/")}>
          <ArrowLeft size={18} /> Tilbake til lageroversikt
        </button>

        <h1>AI Varetelling</h1>
        <p>Live kamera for registrering og telling av varer.</p>

        <div className="camera-preview">
          <video ref={videoRef} autoPlay playsInline muted style={{ display: photoTaken ? "none" : "block" }} />
          <canvas ref={canvasRef} className="detection-canvas" style={{ display: photoTaken ? "block" : "none" }} />
          {!active && !photoTaken && (
            <div className="camera-placeholder">
              <Camera size={42} />
              <span>Kameraet er ikke aktivt</span>
            </div>
          )}
        </div>

        {error && <p className="camera-error">{error}</p>}

        <div className="camera-actions">
          {!active ? (
            <button onClick={startCamera} disabled={!authorized} className="camera-start">
              <Camera size={19} /> Start kamera
            </button>
          ) : (
            <button onClick={stopCamera} className="camera-stop">
              <CameraOff size={19} /> Stopp kamera
            </button>
          )}

          {active && (
            <button className="camera-start" onClick={() => void takePhotoAndCount()} disabled={analyzing}>
              <ScanSearch size={19} /> {analyzing ? "Analyserer bilde..." : "Ta bilde og tell"}
            </button>
          )}
          {photoTaken && (
            <button className="camera-start" onClick={clearPhoto} disabled={analyzing}>
              <RotateCcw size={19} /> Ta nytt bilde
            </button>
          )}
        </div>

        {photoTaken && (
          <div className="detection-results">
            <h3>Objekter i bildet: {detections.length}</h3>
            {Object.entries(counts).length === 0 ? (
              <p>Ingen gjenkjente lagervarer i bildet. Kontroller bildet eller prøv på nytt.</p>
            ) : (
              Object.entries(counts).map(([name, count]) => (
                <p key={name}>{name}: <strong>{count} stk</strong></p>
              ))
            )}
          </div>
        )}

        {/*<section className="inventory-panel">
          <h2>Bekreft varetelling</h2>
          <p>Velg riktig lagervare, kontroller antallet og bekreft før beholdningen endres.</p>

          <label htmlFor="inventory-item">Velg vare</label>
          <select
            id="inventory-item"
            value={selectedItemId}
            onChange={(event) => {
              setSelectedItemId(event.target.value);
              setSaveMessage("");
              setInventoryError("");
            }}
            disabled={!authorized || saving}
          >
            <option value="">Velg en vare fra lageret</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.sku ? ` (${item.sku})` : ""}
              </option>
            ))}
          </select>

          <label htmlFor="object-class">Objekttype oppdaget av AI</label>
          <div className="count-picker">
            <select
              id="object-class"
              value={selectedClass}
              onChange={(event) => setSelectedClass(event.target.value)}
              disabled={saving}
            >
              <option value="">Velg objekttype</option>
              {Object.entries(counts).map(([name, amount]) => (
                <option key={name} value={name}>{name} – {amount} stk</option>
              ))}
              {selectedClass && !(selectedClass in counts) && (
                <option value={selectedClass}>{selectedClass} – 0 stk (ikke synlig)</option>
              )}
            </select>
            <button type="button" className="camera-start" onClick={useAiCount}
              disabled={!selectedClass || saving}>
              Bruk AI-antall
            </button>
          </div>

          <label htmlFor="counted-quantity">Antall telt (kan korrigeres manuelt)</label>
          <input
            id="counted-quantity"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Skriv inn antall"
            value={countedQuantity}
            onChange={(e) => {
              const value = e.target.value;
              if (/^\d*$/.test(value)) {
                setCountedQuantity(value);
                setSaveMessage("");
                setInventoryError("");
              }
            }}
            disabled={saving}
          />

          {selectedItem && (
            <div className="stock-summary">
              <p>Nåværende beholdning: <strong>{selectedItem.quantity} stk</strong></p>
              <p>Antall telt: <strong>{numericCount !== null ? numericCount : "–"} stk</strong></p>
              <p>Avvik: <strong>{difference !== null && Number.isFinite(difference) ? `${difference > 0 ? "+" : ""}${difference} stk` : "–"}</strong></p>
            </div>
          )}

          {inventoryError && <p className="camera-error" role="alert">{inventoryError}</p>}
          {saveMessage && <p className="save-success" role="status">{saveMessage}</p>}
          <button type="button" className="confirm-button" onClick={() => void confirmCount()}
            disabled={!selectedItem || saving || !authorized || !validCount}>
            {saving ? "Lagrer..." : "Bekreft varetelling"}
          </button>
        </section>*/}

        <p className="camera-note">
          AI teller objekter i ett stillbilde. Velg riktig vare og kontroller at hele
          beholdningen er telt før du bekrefter. Modellen kjenner ikke igjen alle
          lagervarer, varenummer eller skjulte objekter. Bildet lagres ikke i Supabase.
        </p>
      </div>

      <style jsx>{`
        .camera-page { min-height: 100vh; background: #f3f6fb; padding: 35px 20px; color: #17243b; }
        .camera-container { max-width: 950px; margin: auto; }
        .camera-back { display: inline-flex; align-items: center; gap: 8px; border: none; background: transparent; color: #335d99; cursor: pointer; margin-bottom: 24px; }
        h1 { font-size: 30px; margin-bottom: 8px; }
        p { color: #64748b; }
        .camera-preview { position: relative; margin-top: 25px; background: #101827; border-radius: 16px; overflow: hidden; aspect-ratio: 16 / 9; }
        video { display: block; width: 100%; height: 100%; object-fit: contain; }
        .detection-canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
        .camera-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #cbd5e1; }
        .camera-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
        .camera-start, .camera-stop { display: inline-flex; align-items: center; gap: 9px; border: none; border-radius: 10px; padding: 13px 22px; color: white; font-weight: 600; cursor: pointer; }
        .camera-start { background: #2563eb; }
        .camera-stop { background: #dc2626; }
        button:disabled { opacity: .5; cursor: not-allowed; }
        .camera-error { color: #dc2626; }
        .camera-note { margin-top: 18px; font-size: 13px; }
        .detection-results { margin-top: 20px; padding: 20px; background: white; border-radius: 12px; }
        .detection-results h3 { margin-bottom: 12px; }
        .detection-results p { margin: 6px 0; }
        .inventory-panel { margin-top: 20px; padding: 24px; border-radius: 14px; background: white; }
        .inventory-panel h2 { font-size: 22px; margin: 0 0 8px; }
        .inventory-panel label { display: block; font-weight: 600; margin: 18px 0 8px; }
        .inventory-panel select, .inventory-panel input { width: 100%; min-width: 0; border: 1px solid #cbd5e1; border-radius: 9px; padding: 12px; font-size: 15px; background: white; color: #17243b; }
        .count-picker { display: flex; flex-wrap: wrap; gap: 10px; }
        .count-picker select { flex: 1 1 200px; }
        .stock-summary { background: #f3f6fb; padding: 15px; border-radius: 10px; margin: 20px 0; }
        .stock-summary p { margin: 8px 0; }
        .confirm-button { background: #15803d; color: white; padding: 13px 22px; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; margin-top: 16px; }
        .save-success { color: #15803d; font-weight: 600; }
      `}</style>
    </main>
  );
}
