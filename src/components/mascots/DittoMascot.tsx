/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Custom Pure CSS/SVG Ditto Advisor Mascot - Creative, crisp, and high craft
export function DittoMascot({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 120 120" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={`${className} hover:scale-105 transition-transform duration-300 select-none`}
    >
      {/* Background soft aura glows */}
      <circle cx="45" cy="55" r="30" fill="#3B82F6" fillOpacity="0.08" />
      <circle cx="85" cy="75" r="25" fill="#60A5FA" fillOpacity="0.08" />

      {/* LEFT CHARACTER: FLYING ANGEL MASCOT (WRITING) */}
      <g id="AngelWriter">
        {/* White Angel Wings behind body */}
        {/* Left Wing */}
        <path 
          d="M26 50C16 46 12 55 18 64C22 68 28 66 32 60C34 57 32 52 26 50Z" 
          fill="#FFFFFF" 
          stroke="#94A3B8" 
          strokeWidth="1" 
          opacity="0.95" 
        />
        <path d="M22 52C16 51 15 57 19 61" stroke="#CBD5E1" strokeWidth="1" strokeLinecap="round" />
        
        {/* Right Wing (slightly masked behind body) */}
        <path 
          d="M32 46C24 40 22 48 26 55" 
          fill="#FFFFFF" 
          stroke="#94A3B8" 
          strokeWidth="1" 
          opacity="0.8" 
        />

        {/* Mascot Body & Limbs */}
        {/* Left Leg */}
        <path d="M34 76C32 84 39 88 41 82C42 80 41 77 39 75" fill="#60A5FA" stroke="#1D4ED8" strokeWidth="1.2" />
        {/* Right Leg */}
        <path d="M50 76C52 84 59 87 59 80C59 77 56 75 52 74" fill="#60A5FA" stroke="#1D4ED8" strokeWidth="1.2" />
        
        {/* Left Arm holding notepad (behind pad) */}
        <path d="M31 60C28 63 29 69 33 69" stroke="#1D4ED8" strokeWidth="1.2" fill="#60A5FA" />

        {/* Main round body with 3 head hair-tufts/spikes */}
        {/* Head hair-tufts (3 rounded spikes on top) */}
        <path 
          d="M38 38C37 32 42 30 45 34C45 32 50 30 52 35C52 32 57 31 58 37C60 40 59 44 57 46" 
          fill="#60A5FA" 
          stroke="#1D4ED8" 
          strokeWidth="1.5" 
          strokeLinejoin="round" 
        />

        {/* Main Body block */}
        <path 
          d="M34 44C34 38 42 36 49 36C56 36 61 40 61 48C61 54 59 74 49 75C39 76 34 58 34 44Z" 
          fill="url(#skyBlueGrad)" 
          stroke="#1D4ED8" 
          strokeWidth="1.5" 
        />

        {/* Gloss highlight on head */}
        <path d="M38 43C38 41 43 39 47 40" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />

        {/* Happy Smiley Face */}
        {/* Left Curved Closed Eye */}
        <path d="M41 48C42 46 45 46 46 48" stroke="#1E293B" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        {/* Right Curved Closed Eye */}
        <path d="M52 48C53 46 56 46 57 48" stroke="#1E293B" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        
        {/* Heart-melting Smile */}
        <path d="M45 52C46 54 49 54 50 52" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M46.5 53C47 55.5 49 55.5 49.5 53" fill="#EF4444" />

        {/* Blush Cheeks */}
        <circle cx="39" cy="51" r="2" fill="#F43F5E" fillOpacity="0.4" />
        <circle cx="58" cy="51" r="2" fill="#F43F5E" fillOpacity="0.4" />

        {/* Arm extending to draw/write */}
        <path d="M54 58C58 58 63 56 65 52" stroke="#1D4ED8" strokeWidth="1.5" fill="#60A5FA" />

        {/* Notepad Clipboard (slanted) */}
        {/* Yellow-Orange cover sheets flipped up */}
        <path 
          d="M59 50 L75 42 C79 40 82 43 78 47 L61 55 Z" 
          fill="#F59E0B" 
          stroke="#B45309" 
          strokeWidth="1.2" 
        />
        {/* Notepad White Sheets body */}
        <rect 
          x="56" 
          y="54" 
          width="18" 
          height="22" 
          rx="1" 
          transform="rotate(-15 56 54)" 
          fill="#FFFFFF" 
          stroke="#475569" 
          strokeWidth="1.2" 
        />
        {/* Written lines inside sheets */}
        <line x1="62" y1="59" x2="71.5" y2="56.5" stroke="#94A3B8" strokeWidth="1" />
        <line x1="61" y1="63.5" x2="70.5" y2="61" stroke="#94A3B8" strokeWidth="1" />
        <line x1="60" y1="68" x2="69.5" y2="65.5" stroke="#94A3B8" strokeWidth="1" />

        {/* Pen/pencil in hand */}
        <line x1="53" y1="58" x2="62" y2="54" stroke="#1E293B" strokeWidth="1.5" strokeLinecap="round" />
      </g>

      {/* RIGHT CHARACTER: THE DIZZY CONFUSED DITTO COMPANION */}
      <g id="DizzyCompanion">
        {/* Legs */}
        <path d="M80 94C80 99 85 101 87 97C88 95 87 93 85 91" fill="#93C5FD" stroke="#2563EB" strokeWidth="1.2" />
        <path d="M92 93C93 98 98 97 98 93C98 91 95 90 93 89" fill="#93C5FD" stroke="#2563EB" strokeWidth="1.2" />

        {/* Left Hand raised in wonder/confusion */}
        <path d="M78 81C74 81 72 76 76 72C78 70 81 72 82 75" fill="#93C5FD" stroke="#2563EB" strokeWidth="1.2" />
        
        {/* Right Hand at side */}
        <path d="M96 82C98 84 99 87 97 89" fill="#93C5FD" stroke="#2563EB" strokeWidth="1.2" />

        {/* Confused Body Block */}
        <path 
          d="M77 64C77 59 84 57 91 57C98 57 101 61 101 68C101 73 99 88 91 89C83 90 77 78 77 64Z" 
          fill="url(#pastelBlueGrad)" 
          stroke="#2563EB" 
          strokeWidth="1.5" 
        />

        {/* Confused / Worried Face */}
        {/* Left worried high-arch eyebrow */}
        <path d="M81 64C82 63 84 63 85 64" stroke="#1E293B" strokeWidth="1" strokeLinecap="round" fill="none" />
        {/* Right worried eyebrow */}
        <path d="M91 64C92 63 94 63 95 64" stroke="#1E293B" strokeWidth="1" strokeLinecap="round" fill="none" />
        {/* Confused O-face mouth */}
        <ellipse cx="88" cy="71" rx="2" ry="2.5" fill="#1E293B" />
        {/* Small black dots for confused focus eyes */}
        <circle cx="83" cy="67" r="1.2" fill="#1E293B" />
        <circle cx="93" cy="67" r="1.2" fill="#1E293B" />

        {/* DIZZY SPARKLY STAR ORBIT RINGS */}
        {/* Ellipse ring around head representing orbit */}
        <ellipse cx="88" cy="51" rx="14" ry="4" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 2" transform="rotate(-5 88 51)" />
        
        {/* Star 1 (Top Left) */}
        <polygon points="76,46 77.5,48.5 80.5,49 78.5,51 79,54 76,52.5 73,54 73.5,51 71.5,49 74.5,48.5" fill="#FBBF24" />
        
        {/* Star 2 (Middle Right) */}
        <polygon points="101,49 102,50.8 104,51.2 102.5,52.5 103,54.5 101,53.5 99,54.5 99.5,52.5 98,51.2 100,50.8" fill="#FBBF24" />

        {/* Star 3 (Top Front) */}
        <polygon points="88,44 89,45.8 91,46.2 89.5,47.5 90,49.5 88,48.5 86,49.5 86.5,47.5 85,46.2 87,45.8" fill="#FBBF24" />
      </g>

      <defs>
        <linearGradient id="skyBlueGrad" x1="47" y1="36" x2="47" y2="75" gradientUnits="userSpaceOnUse">
          <stop stopColor="#93C5FD" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
        <linearGradient id="pastelBlueGrad" x1="89" y1="57" x2="89" y2="89" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BFDBFE" />
          <stop offset="1" stopColor="#60A5FA" />
        </linearGradient>
      </defs>
    </svg>
  );
}
