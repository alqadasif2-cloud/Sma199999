import React from 'react';

interface BackgroundVideoProps {
  overlayOpacity?: string; // 60-70% black transparent overlay, e.g. "bg-black/65"
  className?: string;
}

/**
 * Static high-resolution background displaying the user's Sami Trade Smart gold bull artwork
 * Replaces previous animated video with zero battery/CPU overhead and instant rendering.
 */
export const BackgroundVideo: React.FC<BackgroundVideoProps> = ({
  overlayOpacity = 'bg-black/65',
  className = '',
}) => {
  return (
    <div
      className={`fixed inset-0 w-full h-full overflow-hidden pointer-events-none z-0 ${className}`}
      aria-hidden="true"
    >
      <img
        src="/assets/aistudio/photo_5902052150618035353_y_3013a0af.jpg"
        alt="Sami Trade Smart"
        loading="eager"
        decoding="async"
        className="w-full h-full object-cover object-center select-none pointer-events-none"
      />
      {/* Dark Transparent Overlay (60-70%) for clear text and button legibility */}
      <div className={`absolute inset-0 ${overlayOpacity}`} />
    </div>
  );
};

