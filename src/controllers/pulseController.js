const https = require('https');

const GOOGLE_NEWS_RSS_URL =
  'https://news.google.com/rss/search?q=technology%20OR%20AI%20OR%20startups%20OR%20india&hl=en-IN&gl=IN&ceid=IN:en';

const decodeHtml = (value = '') =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const stripTags = (value = '') => decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const fetchText = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`Request failed with status ${response.statusCode}`));
          return;
        }

        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => resolve(data));
      })
      .on('error', reject);
  });

const extractTag = (source, tagName) => {
  const match = source.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? stripTags(match[1]) : '';
};

const extractItems = (rssText) => {
  const items = rssText.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 8).map((item, index) => {
    const title = extractTag(item, 'title');
    const link = extractTag(item, 'link');
    const pubDate = extractTag(item, 'pubDate');
    const description = extractTag(item, 'description');
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? stripTags(sourceMatch[1]) : 'News';

    return {
      id: `${index + 1}-${title.slice(0, 24)}`,
      title,
      link,
      source,
      published_at: pubDate,
      summary: description,
      tags: inferTags(`${title} ${description}`),
      ai_spark: buildAiSpark(title, description),
    };
  });
};

const inferTags = (text) => {
  const value = text.toLowerCase();
  const tags = [];
  if (value.includes('ai') || value.includes('artificial intelligence')) tags.push('AI');
  if (value.includes('startup') || value.includes('founder')) tags.push('Startup');
  if (value.includes('india')) tags.push('India');
  if (value.includes('policy') || value.includes('government')) tags.push('Policy');
  if (value.includes('security') || value.includes('privacy')) tags.push('Security');
  if (!tags.length) tags.push('Trending');
  return tags.slice(0, 3);
};

const buildAiSpark = (title, description = '') => {
  const topic = stripTags(`${title} ${description}`).slice(0, 220);
  const angle =
    topic.toLowerCase().includes('ai') || topic.toLowerCase().includes('model')
      ? 'How will this change trust, jobs, and daily workflows?'
      : topic.toLowerCase().includes('policy') || topic.toLowerCase().includes('government')
        ? 'Does regulation help users here, or slow useful progress?'
        : 'Who benefits first from this change, and who is left out?';

  return {
    summary: title,
    debate_prompt: angle,
    agree_point: `A supporter might argue this creates momentum because ${topic.toLowerCase().slice(0, 90)}...`,
    counter_point: 'A critic could argue the headline impact is overstated until user-level value is measurable.',
  };
};

const fallbackTopics = [
  {
    id: 'fallback-ai-collab',
    title: 'AI copilots are becoming default tools in team communication products',
    source: 'ChatApp Pulse',
    published_at: new Date().toUTCString(),
    link: 'https://news.google.com',
    summary: 'Teams increasingly expect summaries, debate prompts, and writing assistance directly inside chat.',
    tags: ['AI', 'Product'],
    ai_spark: buildAiSpark(
      'AI copilots are becoming default tools in team communication products',
      'Teams increasingly expect summaries, debate prompts, and writing assistance directly inside chat.'
    ),
  },
  {
    id: 'fallback-realtime',
    title: 'Real-time apps are shifting from simple messaging toward richer collaboration surfaces',
    source: 'ChatApp Pulse',
    published_at: new Date().toUTCString(),
    link: 'https://news.google.com',
    summary: 'Voice notes, calling, invite identity, and contextual feeds are becoming baseline expectations.',
    tags: ['Realtime', 'UX'],
    ai_spark: buildAiSpark(
      'Real-time apps are shifting from simple messaging toward richer collaboration surfaces',
      'Voice notes, calling, invite identity, and contextual feeds are becoming baseline expectations.'
    ),
  },
];

exports.getPulse = async (req, res) => {
  try {
    const raw = await fetchText(GOOGLE_NEWS_RSS_URL);
    const items = extractItems(raw).filter((item) => item.title);

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      topics: items.length ? items : fallbackTopics,
    });
  } catch (error) {
    console.warn('Pulse feed fallback:', error.message);
    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      topics: fallbackTopics,
    });
  }
};
