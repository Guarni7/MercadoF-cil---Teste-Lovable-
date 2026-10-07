/**
 * Demo video da landing (/landing#demo).
 * Cole o ID do YouTube (parte depois de v=) quando tiver o vídeo pronto.
 * Ex.: "QAcV8Q_FIeo" → https://www.youtube.com/watch?v=QAcV8Q_FIeo
 */
export const LANDING_YOUTUBE_ID = "";

export function getLandingYoutubeEmbedUrl(autoplay = true) {
  if (!LANDING_YOUTUBE_ID) return null;
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    ...(autoplay ? { autoplay: "1" } : {}),
  });
  return `https://www.youtube.com/embed/${LANDING_YOUTUBE_ID}?${params.toString()}`;
}
