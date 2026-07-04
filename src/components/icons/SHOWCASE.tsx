/**
 * Icon Components Showcase
 * 
 * This file demonstrates all the different ways to use the icon components
 * in your application. It serves as both documentation and a quick reference.
 * 
 * This is NOT meant to be imported into the app - it's for reference only.
 * Use the patterns shown here in your own components.
 */

import React from "react";
import { 
  DeclarationMapIcon, 
  SvgIcon, 
  SvgIconImage, 
  InlineSvgIcon 
} from "./index";

// ============================================================================
// EXAMPLE 1: Basic DeclarationMapIcon Usage
// ============================================================================

export function BasicDeclarationMapIconExample() {
  return (
    <div className="space-y-4">
      <h2>Basic DeclarationMapIcon</h2>
      
      {/* Default size */}
      <DeclarationMapIcon />
      
      {/* Custom size */}
      <DeclarationMapIcon width={32} height={32} />
      
      {/* With color */}
      <DeclarationMapIcon width={40} height={40} color="#2a9bff" />
    </div>
  );
}

// ============================================================================
// EXAMPLE 2: Icon Sizes Showcase
// ============================================================================

export function IconSizesShowcase() {
  const sizes = [16, 24, 32, 40, 48, 64] as const;
  
  return (
    <div className="space-y-4">
      <h2>Declaration Map Icon - Size Variations</h2>
      <div className="flex gap-8 items-center">
        {sizes.map((size) => (
          <div key={size} className="flex flex-col items-center gap-2">
            <DeclarationMapIcon width={size} height={size} color="#000000" />
            <span className="text-xs text-gray-600">{size}x{size}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 3: Color Variations
// ============================================================================

export function ColorVariationsShowcase() {
  const colors = [
    { name: "Default (Black)", color: "#000000" },
    { name: "Teal", color: "#14b8a6" },
    { name: "Blue", color: "#06b6d4" },
    { name: "Sky", color: "#0284c7" },
    { name: "Cyan", color: "#06b6d4" },
    { name: "Red", color: "#ef4444" },
    { name: "Green", color: "#2ed573" },
    { name: "Orange", color: "#ff9f43" },
  ];
  
  return (
    <div className="space-y-4">
      <h2>Declaration Map Icon - Color Variations</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {colors.map(({ name, color }) => (
          <div key={name} className="flex flex-col items-center gap-2">
            <div className="p-4 bg-gray-100 rounded-lg">
              <DeclarationMapIcon width={32} height={32} color={color} />
            </div>
            <span className="text-xs text-gray-600">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 4: Icon in Badge
// ============================================================================

export function IconInBadgeExample() {
  return (
    <div className="space-y-4">
      <h2>Icon in Badge</h2>
      
      <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-sm font-bold bg-teal-100 text-teal-800 border border-teal-200">
        <DeclarationMapIcon width={16} height={16} color="#14b8a6" />
        Ditto · Advisor Disclosure Logic
      </span>
    </div>
  );
}

// ============================================================================
// EXAMPLE 5: Icon in Header
// ============================================================================

export function IconInHeaderExample() {
  return (
    <div className="space-y-4">
      <h2>Icon in Header</h2>
      
      <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
        <DeclarationMapIcon width={40} height={40} color="#0284c7" />
        <div>
          <h1 className="text-2xl font-bold">Declaration Framework</h1>
          <p className="text-sm text-gray-600">The Complete Map</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 6: Icon in Button
// ============================================================================

export function IconInButtonExample() {
  return (
    <div className="space-y-4">
      <h2>Icon in Button</h2>
      
      <button className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
        <DeclarationMapIcon width={20} height={20} color="white" />
        View Map
      </button>
    </div>
  );
}

// ============================================================================
// EXAMPLE 7: Theme-Aware Icon
// ============================================================================

interface ThemeAwareProps {
  isDarkMode: boolean;
}

export function ThemeAwareIconExample({ isDarkMode }: ThemeAwareProps) {
  const color = isDarkMode ? "#06b6d4" : "#0284c7";
  const bgClass = isDarkMode ? "bg-gray-900" : "bg-white";
  const textClass = isDarkMode ? "text-white" : "text-gray-900";
  
  return (
    <div className={`space-y-4 p-4 rounded-lg ${bgClass} ${textClass}`}>
      <h2>Theme-Aware Icon</h2>
      
      <div className="flex items-center gap-3">
        <DeclarationMapIcon width={32} height={32} color={color} />
        <span className="text-sm font-semibold">
          {isDarkMode ? "Dark Mode" : "Light Mode"}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 8: Icon Grid
// ============================================================================

export function IconGridExample() {
  const items = [
    { label: "Dashboard", color: "#06b6d4" },
    { label: "Maps", color: "#2a9bff" },
    { label: "Settings", color: "#14b8a6" },
    { label: "Reports", color: "#ff9f43" },
  ];
  
  return (
    <div className="space-y-4">
      <h2>Icon Grid</h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map(({ label, color }) => (
          <button
            key={label}
            className="p-4 flex flex-col items-center gap-2 rounded-lg border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition group"
          >
            <DeclarationMapIcon width={32} height={32} color={color} />
            <span className="text-sm font-semibold text-gray-700 group-hover:text-blue-600">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 9: Icon with Animation
// ============================================================================

export function IconWithAnimationExample() {
  return (
    <div className="space-y-4">
      <h2>Icon with Animation</h2>
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .icon-spin {
          animation: spin 2s linear infinite;
        }
      `}</style>
      
      <div className="flex gap-4">
        {/* Spin animation */}
        <div className="icon-spin">
          <DeclarationMapIcon width={32} height={32} color="#0284c7" />
        </div>
        
        {/* Hover scale */}
        <div className="hover:scale-125 hover:text-blue-600 transition-transform duration-200 cursor-pointer">
          <DeclarationMapIcon width={32} height={32} color="#0284c7" />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 10: Responsive Icon
// ============================================================================

export function ResponsiveIconExample() {
  return (
    <div className="space-y-4">
      <h2>Responsive Icon</h2>
      
      <div className="space-y-4">
        {/* Mobile */}
        <div className="md:hidden flex gap-2 items-center">
          <DeclarationMapIcon width={24} height={24} color="#0284c7" />
          <span className="text-sm">Mobile View</span>
        </div>
        
        {/* Tablet */}
        <div className="hidden md:flex lg:hidden gap-2 items-center">
          <DeclarationMapIcon width={32} height={32} color="#0284c7" />
          <span className="text-base">Tablet View</span>
        </div>
        
        {/* Desktop */}
        <div className="hidden lg:flex gap-2 items-center">
          <DeclarationMapIcon width={40} height={40} color="#0284c7" />
          <span className="text-lg">Desktop View</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN SHOWCASE COMPONENT
// ============================================================================

export function IconShowcase() {
  return (
    <div className="p-8 space-y-12 max-w-6xl mx-auto">
      <div>
        <h1 className="text-4xl font-bold mb-2">Icon Components Showcase</h1>
        <p className="text-gray-600">
          Explore all the different ways to use the icon components in your application
        </p>
      </div>
      
      <BasicDeclarationMapIconExample />
      <IconSizesShowcase />
      <ColorVariationsShowcase />
      <IconInBadgeExample />
      <IconInHeaderExample />
      <IconInButtonExample />
      <ThemeAwareIconExample isDarkMode={false} />
      <ThemeAwareIconExample isDarkMode={true} />
      <IconGridExample />
      <IconWithAnimationExample />
      <ResponsiveIconExample />
    </div>
  );
}
