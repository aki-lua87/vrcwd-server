export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  
  const entities: { [key: string]: string } = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&#x27;': "'",
    '&#x60;': '`',
    '&nbsp;': ' '
  };

  return text.replace(/&[#\w]+;/g, (entity) => {
    if (entities[entity]) return entities[entity];
    
    // Handle numeric entities
    if (entity.startsWith('&#')) {
      const code = entity.startsWith('&#x') 
        ? parseInt(entity.slice(3, -1), 16) 
        : parseInt(entity.slice(2, -1), 10);
      
      if (!isNaN(code)) {
        return String.fromCharCode(code);
      }
    }
    
    return entity;
  });
}
