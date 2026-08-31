export function getMethodColor(method: string) {
  switch(method) {
    case 'GET': return 'text-blue-500';
    case 'POST': return 'text-green-500';
    case 'PUT': return 'text-orange-500';
    case 'PATCH': return 'text-amber-500';
    case 'DELETE': return 'text-destructive';
    case 'HEAD': return 'text-purple-500';
    default: return 'text-muted-foreground';
  }
}

export const formatJson = (str: string) => {
  if (!str) return '';
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
};
