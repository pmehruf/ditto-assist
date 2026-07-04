# Icon Components Usage Guide

This directory contains reusable icon components for the Declaration Assistant application.

## Components Overview

### 1. `DeclarationMapIcon`
A specialized icon component that renders the declaration map/route icon used for framework visualization.

**Features:**
- Customizable size (width/height)
- Customizable color
- Fully accessible with ARIA labels
- Optimized SVG rendering

**Usage:**
```tsx
import { DeclarationMapIcon } from '@/components/icons';

// Default (24x24, black)
<DeclarationMapIcon />

// With custom size and color
<DeclarationMapIcon 
  width={32} 
  height={32} 
  color="#2a9bff" 
/>

// With className for additional styling
<DeclarationMapIcon 
  width={40} 
  height={40} 
  color="#06b6d4"
  className="hover:opacity-80 transition-opacity"
/>
```

### 2. `SvgIcon`
A generic reusable SVG icon component that loads SVG files from disk.

**Features:**
- Load external SVG files
- Customizable dimensions
- Color support (via CSS filter)
- Accessibility-first design

**Usage:**
```tsx
import { SvgIcon } from '@/components/icons';

// Basic usage
<SvgIcon src="/icons/my-icon.svg" width={24} height={24} />

// With color (applies drop-shadow effect)
<SvgIcon 
  src="/icons/my-icon.svg" 
  width={32} 
  height={32} 
  color="#2a9bff"
  className="hover:scale-105 transition-transform"
  alt="Custom Icon"
/>
```

### 3. `SvgIconImage`
Alternative SVG icon component using the `<img>` tag for better browser support.

**Usage:**
```tsx
import { SvgIconImage } from '@/components/icons';

<SvgIconImage 
  src="/icons/my-icon.svg" 
  width={24} 
  height={24} 
  alt="Icon description"
/>
```

### 4. `InlineSvgIcon`
Inline SVG component for rendering SVG content directly without external files.

**Usage:**
```tsx
import { InlineSvgIcon } from '@/components/icons';

<InlineSvgIcon width={24} height={24} color="#000000" alt="Icon">
  <path d="M10 10 L20 20" />
  {/* SVG content here */}
</InlineSvgIcon>
```

## Integration Examples

### Example 1: Using in Header
```tsx
import { DeclarationMapIcon } from '@/components/icons';

export function PageHeader() {
  return (
    <div className="flex items-center gap-3">
      <DeclarationMapIcon width={40} height={40} color="#06b6d4" />
      <h1>Declaration Framework</h1>
    </div>
  );
}
```

### Example 2: Using in Badge
```tsx
import { DeclarationMapIcon } from '@/components/icons';

export function IconBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full">
      <DeclarationMapIcon width={14} height={14} color="#14b8a6" />
      Ditto · Advisor Disclosure Logic
    </span>
  );
}
```

### Example 3: Multiple Sizes
```tsx
import { DeclarationMapIcon } from '@/components/icons';

export function IconSizes() {
  return (
    <div className="flex gap-4">
      {/* Small */}
      <DeclarationMapIcon width={16} height={16} color="#000000" />
      
      {/* Medium */}
      <DeclarationMapIcon width={24} height={24} color="#000000" />
      
      {/* Large */}
      <DeclarationMapIcon width={48} height={48} color="#000000" />
      
      {/* Extra Large */}
      <DeclarationMapIcon width={64} height={64} color="#000000" />
    </div>
  );
}
```

### Example 4: Theme-Aware Colors
```tsx
import { DeclarationMapIcon } from '@/components/icons';

export function ThemedIcon({ isDarkMode }: { isDarkMode: boolean }) {
  return (
    <DeclarationMapIcon 
      width={32} 
      height={32} 
      color={isDarkMode ? "#06b6d4" : "#0284c7"}
    />
  );
}
```

## Exporting from index.ts

The `index.ts` file exports all icon components for convenient importing:

```tsx
// Import all icons at once
import { 
  DeclarationMapIcon, 
  SvgIcon, 
  SvgIconImage, 
  InlineSvgIcon 
} from '@/components/icons';
```

## Creating New Icon Components

To add a new icon component:

1. **Create a new file** in the icons directory (e.g., `MyCustomIcon.tsx`)
2. **Define the component** with TypeScript types
3. **Export it** in `index.ts`
4. **Document** usage in this guide

Example template:
```tsx
import React from "react";

interface MyCustomIconProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  color?: string;
}

export const MyCustomIcon: React.FC<MyCustomIconProps> = ({
  width = 24,
  height = 24,
  className = "",
  color = "#000000",
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 512 512"
      className={className}
      fill={color}
      aria-label="My Custom Icon"
      role="img"
    >
      {/* SVG paths go here */}
    </svg>
  );
};
```

## Accessibility Features

All icon components include:
- ✅ ARIA labels for screen readers
- ✅ Semantic SVG role attributes
- ✅ Color contrast support
- ✅ Responsive sizing

## Performance Considerations

- **DeclarationMapIcon**: Inline SVG, no external file loading
- **SvgIcon**: Uses `<use>` reference for efficient caching
- **SvgIconImage**: Standard image tag, browser-optimized
- **InlineSvgIcon**: Direct SVG rendering, best for dynamic content

Choose based on your use case:
- Static icons → `DeclarationMapIcon` (best performance)
- External SVG files → `SvgIcon` or `SvgIconImage`
- Dynamic/procedural icons → `InlineSvgIcon`

## Color Format Support

All color properties support:
- ✅ Hex: `#000000`, `#fff`
- ✅ RGB: `rgb(0, 0, 0)`
- ✅ RGBA: `rgba(0, 0, 0, 0.5)`
- ✅ Named colors: `black`, `white`, `red`

## Browser Compatibility

- ✅ Modern browsers (Chrome, Firefox, Safari, Edge)
- ✅ IE11+ (with polyfills for some features)
- ✅ Mobile browsers (iOS Safari, Chrome Android)

## Contributing New Icons

When adding new icons:
1. Ensure SVG is optimized (remove unnecessary attributes)
2. Use consistent viewBox (0 0 512 512 recommended)
3. Add JSDoc comments with examples
4. Update this guide with usage examples
5. Test accessibility with screen readers
