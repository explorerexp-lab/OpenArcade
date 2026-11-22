import React, { useRef, useState } from 'react';

interface MobileTouchControlsProps {
  visible: boolean;
  canInteract: boolean;
  onJoystickMove: (x: number, z: number) => void;
  onAction: (action: 'jump' | 'dash' | 'strike' | 'interact') => void;
}

export const MobileTouchControls: React.FC<MobileTouchControlsProps> = ({
  visible,
  canInteract,
  onJoystickMove,
  onAction,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  if (!visible) return null;

  const MAX_RADIUS = 38;

  const updateStick = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_RADIUS) {
      dx = (dx / dist) * MAX_RADIUS;
      dy = (dy / dist) * MAX_RADIUS;
    }
    setKnob({ x: dx, y: dy });
    onJoystickMove(dx / MAX_RADIUS, dy / MAX_RADIUS);
  };

  const resetStick = () => {
    pointerIdRef.current = null;
    setKnob({ x: 0, y: 0 });
    onJoystickMove(0, 0);
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-15 flex items-end justify-between px-5 pb-6 select-none"
      data-testid="mobile-touch-controls"
    >
      {/* Left Virtual Thumbstick */}
      <div
        ref={padRef}
        role="slider"
        aria-label="Movement Joystick"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Math.round(knob.x)}
        onPointerDown={(e) => {
          e.stopPropagation();
          pointerIdRef.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateStick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointerIdRef.current !== e.pointerId) return;
          e.stopPropagation();
          updateStick(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (pointerIdRef.current !== e.pointerId) return;
          resetStick();
        }}
        onPointerCancel={resetStick}
        className="pointer-events-auto relative flex h-28 w-28 touch-none items-center justify-center rounded-full border-2 border-[#e5a94c]/45 bg-[#101520]/75"
      >
        <div
          className="h-11 w-11 rounded-full border border-[#f5d18c] bg-[#e5a94c]/80 shadow-md"
          style={{
            transform: `translate(${knob.x}px, ${knob.y}px)`,
          }}
        />
      </div>

      {/* Right Tactile Action Cluster (44px+ hit targets) */}
      <div className="pointer-events-auto grid grid-cols-2 gap-2.5">
        {canInteract ? (
          <button
            type="button"
            aria-label="Commune with Shrine"
            onPointerDown={(e) => {
              e.stopPropagation();
              onAction('interact');
            }}
            className="flex h-13 w-13 touch-none items-center justify-center rounded-full border border-[#52c78c] bg-[#132922]/90 font-mono text-[11px] font-bold text-[#8ef0bc] uppercase active:scale-95"
          >
            USE
          </button>
        ) : (
          <div className="h-13 w-13" />
        )}

        <button
          type="button"
          aria-label="Dash"
          onPointerDown={(e) => {
            e.stopPropagation();
            onAction('dash');
          }}
          className="flex h-13 w-13 touch-none items-center justify-center rounded-full border border-[#5ec9e8]/75 bg-[#11222e]/90 font-mono text-[11px] font-bold text-[#9be4fa] uppercase active:scale-95"
        >
          DASH
        </button>

        <button
          type="button"
          aria-label="Jump"
          onPointerDown={(e) => {
            e.stopPropagation();
            onAction('jump');
          }}
          className="flex h-13 w-13 touch-none items-center justify-center rounded-full border border-[#f3ece0]/45 bg-[#141a26]/90 font-mono text-[11px] font-bold text-[#f3ece0] uppercase active:scale-95"
        >
          JUMP
        </button>

        <button
          type="button"
          aria-label="Resonance Strike"
          onPointerDown={(e) => {
            e.stopPropagation();
            onAction('strike');
          }}
          className="flex h-14 w-14 touch-none items-center justify-center rounded-full border-2 border-[#f5d18c] bg-[#e5a94c]/90 font-mono text-[11px] font-bold text-[#101520] uppercase active:scale-95"
        >
          STRIKE
        </button>
      </div>
    </div>
  );
};
