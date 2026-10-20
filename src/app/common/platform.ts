import { isInstalled } from '../ui';

// Safari on iPhone and iPad deletes a site's script-written storage after 7 days without a visit, unless the site was
// added to the home screen (design §6.14). iPadOS asks for the desktop site, so it reads as a Mac with touch.
export function evictsUnlessInstalled(): boolean {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return apple && !isInstalled();
}
