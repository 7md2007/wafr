// Public settings for the deployed site. NO secrets here — this file is sent to every visitor.
// aiUrl: address of your Baloot AI server (baloot/ai-worker), e.g. 'https://baloot-ai.<you>.workers.dev/read'.
// Empty = no server: inside Claude the viewer's Claude reads photos; elsewhere a personal key from ⋯ settings, or tap the cards.
window.BALOOT_CONFIG = window.BALOOT_CONFIG || { aiUrl: '' };
