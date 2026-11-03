import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { load as parseHTML } from 'cheerio';

type FeedText = {
  $t: string;
};

type FeedEntry = {
  id: FeedText;
  title: FeedText;
  published: FeedText;
  content?: FeedText;
  media$thumbnail?: { url: string };
};

type FeedResponse = {
  feed?: {
    category?: { term: string }[];
    entry?: FeedEntry[];
    openSearch$totalResults?: FeedText;
  };
};

type FeedEntryResponse = {
  entry?: FeedEntry;
};

const BASE = 'https://kaoritranslation.blogspot.com';
const FEED = BASE + '/feeds/posts';
const PAGE_SIZE = 24;
const ENG = /^\[ENG\]\s*/i;
const NON_CHAPTER = /il+ustra/i;
const COVER_DEPTH = 3;
const coverCache = new Map<string, string>();
let labelsPromise: Promise<string[]> | undefined;

class KaoriTranslations implements Plugin.PluginBase {
  id = 'kaoritranslations';
  name = 'Kaori TL';
  version = '1.0.1';
  site = BASE;
  icon = 'src/en/kaoritranslations/icon.png';

  private labels(): Promise<string[]> {
    if (!labelsPromise) {
      labelsPromise = (async () => {
        const response = await fetchApi(
          `${FEED}/summary?alt=json&max-results=1`,
        );
        const data: FeedResponse = await response.json();
        return (data.feed?.category ?? [])
          .map(category => category.term)
          .filter(label => ENG.test(label))
          .sort((a, b) => a.localeCompare(b, 'en'));
      })();
    }
    return labelsPromise;
  }

  private labelFromPath(novelPath: string): string {
    const label = new URL(novelPath).searchParams.get('category');
    if (!label) throw new Error('Kaori TL: invalid novel address.');
    return label;
  }

  private async toNovelItem(label: string): Promise<Plugin.NovelItem> {
    let cover = defaultCover;
    try {
      cover = await this.coverFor(label);
    } catch {
      cover = defaultCover;
    }
    return {
      name: label.replace(ENG, '').trim(),
      path: `${FEED}/summary?alt=json&max-results=${PAGE_SIZE}&category=${encodeURIComponent(label)}`,
      cover,
    };
  }

  private async toNovelItems(labels: string[]): Promise<Plugin.NovelItem[]> {
    const items: Plugin.NovelItem[] = [];
    for (let i = 0; i < labels.length; i += 6) {
      items.push(
        ...(await Promise.all(
          labels.slice(i, i + 6).map(label => this.toNovelItem(label)),
        )),
      );
    }
    return items;
  }

  private async coverFor(label: string): Promise<string> {
    const cached = coverCache.get(label);
    if (cached) return cached;
    const response = await fetchApi(
      `${FEED}/summary?alt=json&max-results=${COVER_DEPTH}&category=${encodeURIComponent(label)}`,
    );
    const data: FeedResponse = await response.json();
    const thumbnail = (data.feed?.entry ?? []).find(
      entry => entry.media$thumbnail,
    )?.media$thumbnail?.url;
    const cover = thumbnail
      ? thumbnail.replace(/\/s\d+(-c)?\//, '/s320/')
      : defaultCover;
    coverCache.set(label, cover);
    return cover;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const labels = await this.labels();
    return this.toNovelItems(
      labels.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE),
    );
  }
  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const label = this.labelFromPath(novelPath);
    const posts: FeedEntry[] = [];
    let startIndex = 1;
    let total = 0;
    do {
      const response = await fetchApi(
        `${FEED}/summary?alt=json&max-results=${PAGE_SIZE}&start-index=${startIndex}&category=${encodeURIComponent(label)}`,
      );
      const data: FeedResponse = await response.json();
      const entries = data.feed?.entry ?? [];
      if (!entries.length) break;
      posts.push(...entries);
      total = Number(data.feed?.openSearch$totalResults?.$t ?? 0);
      startIndex += entries.length;
    } while (startIndex <= total);

    const chapters = posts
      .filter(post => !NON_CHAPTER.test(post.title.$t))
      .map(post => {
        const id = /post-(\d+)$/.exec(post.id.$t)?.[1];
        if (!id) return undefined;
        return {
          name: post.title.$t.replace(ENG, '').trim(),
          path: `${FEED}/default/${id}?alt=json`,
          releaseTime: post.published.$t,
        };
      })
      .filter(chapter => chapter !== undefined);

    if (!chapters.length) {
      throw new Error('Kaori TL: no chapters were found.');
    }
    const thumbnail = posts.find(post => post.media$thumbnail)?.media$thumbnail
      ?.url;

    return {
      name: label.replace(ENG, '').trim(),
      path: novelPath,
      cover: thumbnail
        ? thumbnail.replace(/\/s\d+(-c)?\//, '/s320/')
        : defaultCover,
      chapters: chapters.reverse(),
    };
  }
  async parseChapter(chapterPath: string): Promise<string> {
    const response = await fetchApi(chapterPath);
    if (!response.ok) {
      throw new Error(`Kaori TL: HTTP ${response.status}.`);
    }
    const data: FeedEntryResponse = await response.json();
    const html = data.entry?.content?.$t;
    if (!html) throw new Error('Kaori TL: no chapter content was found.');

    const $ = parseHTML(html);
    $('script, style, iframe, noscript').remove();
    $('p').each((_, el) => {
      const node = $(el);
      if (/^toc$/i.test(node.text().trim())) node.remove();
    });
    return $('body').html() ?? html;
  }
  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const terms = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const matches = (await this.labels()).filter(label =>
      terms.every(term => label.replace(ENG, '').toLowerCase().includes(term)),
    );
    return this.toNovelItems(
      matches.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE),
    );
  }
}
export default new KaoriTranslations();
