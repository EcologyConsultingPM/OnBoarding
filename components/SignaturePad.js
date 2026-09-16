"use client";

import { useRef, useEffect, useId, useState } from "react";
import { Eraser } from "lucide-react";

// Finger/mouse signature capture. Stores the drawn signature as a PNG data URL
// via onChange. Works on touch and pointer devices.
export default function SignaturePad({ value, onChange, label }) {
  const labelId = useId();
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [hasInk, setHasInk] = useState(!!value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#12211a";
    // Restore an existing signature if provided.
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = value;
    }
  }, []); // eslint-disable-line

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setHasInk(true);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange && onChange(canvasRef.current.toDataURL("image/png"));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange && onChange("");
  };

  return (
    <div className="sig">
      {label ? <span className="sig-label" id={labelId}>{label}</span> : null}
      <div className="sig-wrap">
        <canvas
          ref={canvasRef}
          className="sig-canvas"
          role="img"
          tabIndex={0}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : "Signature drawing area"}
          style={{ touchAction: "none" }}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end}
        />
        {!hasInk ? <span className="sig-hint">Sign with your finger or mouse</span> : null}
        <button type="button" className="sig-clear" onClick={clear} title="Clear signature" aria-label={`Clear ${label || "signature"}`}><Eraser size={13} /></button>
      </div>
    </div>
  );
}
