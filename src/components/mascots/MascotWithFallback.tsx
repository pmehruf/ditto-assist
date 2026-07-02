/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";

// Resilient Mascot component with interactive high-craft pure SVG fallbacks for when disk files are not present
export function MascotWithFallback({ 
  src, 
  alt, 
  className = "", 
  type = "magnifier",
  style
}: { 
  src: string; 
  alt: string; 
  className?: string; 
  type?: "magnifier" | "laptop" | "notepad" | "doctor";
  style?: React.CSSProperties;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    if (type === "magnifier") {
      return (
        <span className={`${className} flex justify-center items-center select-none`} style={style}>
          <svg viewBox="0 0 160 160" className="w-full h-full max-h-[140px] drop-shadow-md">
            {/* Ambient Background Aura */}
            <circle cx="80" cy="80" r="50" fill="#117FDA" fillOpacity="0.08" className="animate-pulse" />
            
            {/* Wings */}
            <path d="M45,65 C25,55 20,70 30,85 C38,95 48,90 52,80" fill="#FFFFFF" stroke="#117FDA" strokeWidth="2.5" />
            <path d="M115,65 C135,55 140,70 130,85 C122,95 112,90 108,80" fill="#FFFFFF" stroke="#117FDA" strokeWidth="2.5" />
            
            {/* Mascot Body */}
            <rect x="50" y="45" width="60" height="70" rx="30" fill="#117FDA" />
            
            {/* Tummy (Light Blue) with Music Note/Ditto mark logo */}
            <circle cx="80" cy="82" r="20" fill="#60A5FA" fillOpacity="0.8" />
            <path d="M78,74 L78,84 A4,4 0 0,1 74,88 A4,4 0 0,1 70,84 A4,4 0 0,1 78,80 L78,74" fill="#0C1D33" />
            <path d="M78,74 L84,76 L84,79 L78,77 Z" fill="#0C1D33" />

            {/* Eyes */}
            <ellipse cx="68" cy="62" rx="3" ry="3.5" fill="#0C1D33" />
            <ellipse cx="92" cy="62" rx="3" ry="3.5" fill="#0C1D33" />
            
            {/* Cheek shine */}
            <circle cx="63" cy="68" r="3" fill="#FFC0CB" fillOpacity="0.6" />
            <circle cx="97" cy="68" r="3" fill="#FFC0CB" fillOpacity="0.6" />

            {/* Confident Smile */}
            <path d="M75,67 Q80,72 85,67" stroke="#0C1D33" strokeWidth="2" strokeLinecap="round" fill="none" />

            {/* Magnifying Glass */}
            <g className="animate-bounce" style={{ animationDuration: "3s" }}>
              {/* Handle */}
              <line x1="95" y1="95" x2="115" y2="115" stroke="#94A3B8" strokeWidth="6" strokeLinecap="round" />
              {/* Rim */}
              <circle cx="95" cy="95" r="15" fill="#FFFFFF" fillOpacity="0.1" stroke="#334155" strokeWidth="4.5" />
              {/* Lens shine */}
              <path d="M87,90 Q93,86 98,92" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />
            </g>
            
            {/* Sparkles of curiosity */}
            <path d="M35,35 L37,39 L41,39 L38,41 L40,45 L36,42 L32,44 L34,40 L31,37 L35,37 Z" fill="#FBBF24" className="animate-pulse" />
            <path d="M125,45 L126,48 L129,48 L127,50 L128,53 L125,51 L122,52 L124,49 L122,47 L125,47 Z" fill="#FBBF24" className="animate-pulse" style={{ animationDelay: "0.5s" }} />
          </svg>
        </span>
      );
    }

    if (type === "laptop") {
      return (
        <span className={`${className} flex justify-center items-center select-none`} style={style}>
          <svg viewBox="0 0 160 160" className="w-full h-full drop-shadow-md">
            {/* Wings */}
            <path d="M40,55 C23,48 18,60 27,72 C34,80 43,76 46,68" fill="#FFFFFF" stroke="#005B9E" strokeWidth="2" />
            <path d="M100,55 C117,48 122,60 113,72 C106,80 97,76 94,68" fill="#FFFFFF" stroke="#005B9E" strokeWidth="2" />

            {/* Mascot Body */}
            <rect x="42" y="38" width="56" height="60" rx="28" fill="#117FDA" />

            {/* Headset */}
            <path d="M42,65 A28,28 0 0,1 98,65" stroke="#334155" strokeWidth="4" fill="none" />
            <rect x="38" y="60" width="6" height="10" rx="3" fill="#1E293B" />
            <rect x="96" y="60" width="6" height="10" rx="3" fill="#1E293B" />
            <path d="M40,70 Q45,82 55,80" stroke="#1E293B" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="55" cy="80" r="2.5" fill="#3B82F6" />

            {/* Tummy */}
            <circle cx="70" cy="74" r="16" fill="#60A5FA" fillOpacity="0.8" />
            
            {/* Eyes closed in pleasant work bliss */}
            <path d="M58,54 Q62,59 66,54" stroke="#0C1D33" strokeWidth="2" strokeLinecap="round" fill="none" />
            <path d="M74,54 Q78,59 82,54" stroke="#0C1D33" strokeWidth="2" strokeLinecap="round" fill="none" />
            <path d="M66,64 Q70,68 74,64" stroke="#0C1D33" strokeWidth="2" strokeLinecap="round" fill="none" />

            {/* Glossy Sleek Dark Laptop */}
            <path d="M45,95 L95,95 L102,112 L38,112 Z" fill="#1E293B" stroke="#475569" strokeWidth="2" />
            <path d="M38,112 L102,112 L102,115 L38,115 Z" fill="#475569" />
            {/* Keyboard glowing pattern */}
            <rect x="48" y="100" width="44" height="6" rx="1.5" fill="#38BDF8" fillOpacity="0.4" />
            {/* Screen glow light */}
            <path d="M45,95 L95,95 L85,75 L55,75 Z" fill="#38BDF8" fillOpacity="0.15" />
          </svg>
        </span>
      );
    }

    if (type === "notepad") {
      return (
        <span className={`${className} flex justify-center items-center select-none`} style={style}>
          <svg viewBox="0 0 160 160" className="w-full h-full drop-shadow-md">
            {/* Ambient Aura */}
            <circle cx="80" cy="80" r="48" fill="#10B981" fillOpacity="0.06" />

            {/* Wings */}
            <path d="M42,65 C22,55 17,70 27,85 C35,95 45,90 49,80" fill="#FFFFFF" stroke="#D1FAE5" strokeWidth="2.5" />
            
            {/* Mascot Body */}
            <rect x="48" y="45" width="58" height="68" rx="29" fill="#117FDA" />
            
            {/* Eyes */}
            <path d="M60,62 Q64,57 68,62" stroke="#0C1D33" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M80,62 Q84,57 88,62" stroke="#0C1D33" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            
            {/* Smiling Mouth */}
            <circle cx="74" cy="74" r="5" fill="#0C1D33" />
            {/* Covering top of mouth to make half-circle */}
            <rect x="68" y="68" width="12" height="6" fill="#117FDA" />

            {/* Glowing Orange Underwriting Notepad Clipboard */}
            <g className="animate-pulse" style={{ animationDuration: "4s" }}>
              <rect x="80" y="70" width="44" height="58" rx="5" fill="#F59E0B" stroke="#D97706" strokeWidth="2" />
              {/* Clip */}
              <rect x="94" y="65" width="16" height="7" rx="2" fill="#94A3B8" />
              {/* Paper rows */}
              <rect x="86" y="77" width="32" height="4" rx="1" fill="#FFFFFF" />
              <rect x="86" y="85" width="32" height="2" rx="1" fill="#FEF3C7" opacity="0.8" />
              <rect x="86" y="91" width="24" height="2" rx="1" fill="#FEF3C7" opacity="0.8" />
              <rect x="86" y="97" width="28" height="2" rx="1" fill="#FEF3C7" opacity="0.8" />
              <rect x="86" y="103" width="16" height="2" rx="1" fill="#FEF3C7" opacity="0.8" />
              
              {/* Green checkmarks representing clinical declarations verified */}
              <path d="M88,112 L92,116 L98,110" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>

            {/* Sparkles */}
            <circle cx="130" cy="55" r="3" fill="#F59E0B" className="animate-ping" />
          </svg>
        </span>
      );
    }

    if (type === "doctor") {
      return (
        <span className={`${className} flex justify-center items-center select-none`} style={style}>
          <svg viewBox="0 0 160 160" className="w-full h-full drop-shadow-md">
            {/* Ambient background aura */}
            <circle cx="80" cy="80" r="50" fill="#3B82F6" fillOpacity="0.08" className="animate-pulse" />
            
            {/* Wings */}
            <path d="M42,65 C22,55 17,70 27,85 C35,95 45,90 49,80" fill="#FFFFFF" stroke="#3B82F6" strokeWidth="2.5" />
            <path d="M118,65 C138,55 143,70 133,85 C125,95 115,90 111,80" fill="#FFFFFF" stroke="#3B82F6" strokeWidth="2.5" />
            
            {/* Mascot Body */}
            <rect x="48" y="45" width="64" height="70" rx="32" fill="#117FDA" />
            
            {/* Doctor's White Lab Coat Overlap */}
            <path d="M48,75 L65,75 L60,115 L48,115 Z" fill="#FFFFFF" opacity="0.9" />
            <path d="M112,75 L95,75 L100,115 L112,115 Z" fill="#FFFFFF" opacity="0.9" />
            
            {/* Stethoscope */}
            <path d="M68,75 Q80,100 92,75" fill="none" stroke="#64748B" strokeWidth="3.5" />
            {/* Chestpiece / Diaphragm */}
            <circle cx="80" cy="95" r="5" fill="#94A3B8" stroke="#64748B" strokeWidth="2" />
            
            {/* Earpieces */}
            <path d="M68,68 Q68,62 72,62" fill="none" stroke="#64748B" strokeWidth="2" />
            <path d="M92,68 Q92,62 88,62" fill="none" stroke="#64748B" strokeWidth="2" />
            
            {/* Eyes */}
            <ellipse cx="68" cy="62" rx="3.5" ry="4" fill="#0C1D33" />
            <ellipse cx="92" cy="62" rx="3.5" ry="4" fill="#0C1D33" />
            
            {/* Confident Doctor Smile */}
            <path d="M75,69 Q80,73 85,69" stroke="#0C1D33" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            
            {/* Head Mirror / Reflector */}
            <circle cx="80" cy="42" r="8" fill="#F8FAFC" stroke="#64748B" strokeWidth="2.5" />
            {/* Mirror light reflection */}
            <circle cx="82" cy="40" r="3" fill="#60A5FA" opacity="0.7" />
          </svg>
        </span>
      );
    }
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => {
        console.log(`Image loading failed for ${src}. Showing specialized pure SVG mascot character!`);
        setHasError(true);
      }}
      referrerPolicy="no-referrer"
    />
  );
}
