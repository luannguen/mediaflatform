/**
 * Safe SVG Inspection & Sanitization Policy
 */
export interface SvgInspectionResult {
  isSafe: boolean;
  hasScriptOrExecutable: boolean;
  reason?: string;
}

export function inspectSvgSafety(svgContent: string): SvgInspectionResult {
  if (!svgContent) {
    return { isSafe: false, hasScriptOrExecutable: true, reason: 'Empty SVG content' };
  }

  const lower = svgContent.toLowerCase();

  // Dangerous vectors
  const dangerousPatterns = [
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i,
    /\bon[a-z]+\s*=/i,
    /(?:href|src)\s*=\s*["'](?!#)/i,
    /url\s*\(|@import|<style|<animate|<set[\s>]/i,
    /&#|&[a-z]+;/i,
    /<script/i,
    /javascript:/i,
    /<foreignobject/i,
    /onload\s*=/i,
    /onerror\s*=/i,
    /onclick\s*=/i,
    /onmouseover\s*=/i,
    /<iframe/i,
    /<embed/i,
    /<object/i,
    /<use[^>]+href\s*=\s*["']https?:/i,
    /<use[^>]+xlink:href\s*=\s*["']https?:/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(lower)) {
      return {
        isSafe: false,
        hasScriptOrExecutable: true,
        reason: `SVG contains potentially hazardous payload matching ${pattern.toString()}`,
      };
    }
  }

  return {
    isSafe: true,
    hasScriptOrExecutable: false,
  };
}

export function sanitizeSvg(svgContent: string): string {
  if (!svgContent) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  return svgContent
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignobject[\s\S]*?>[\s\S]*?<\/foreignobject>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/href\s*=\s*['"]javascript:.*?['"]/gi, '')
    .replace(/xlink:href\s*=\s*['"]javascript:.*?['"]/gi, '');
}
