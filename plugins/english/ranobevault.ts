import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

type Series = {
  id: string;
  title: string;
  cover: string;
  genres: string[];
  synopsis: string;
  latest_volume: number;
  latest_chapter: number;
  status: string;
  author: string;
  rating: number;
};

type ChapterIndex = {
  id: string;
  chapters: ChapterItemJson[];
};

type ChapterItemJson = {
  volume: number;
  chapter: number;
  title: string;
  hash: string;
  locked: boolean;
};
type HashEntry = {
  series: string;
  volume: number;
  chapter: number;
  file: string;
  locked: boolean;
  prev: string | null;
  next: string | null;
  adwallUrl?: string;
  unlockKey?: string;
};
type ChapterData = {
  title: string;
  volume: number;
  chapter: number;
  series: string;
  content: string[];
};
type UpdateEntry = {
  series_id: string;
  title: string;
  cover: string;
  reason: string;
  url: string;
  timestamp: string;
};

const SITE = 'https://ranobevault.github.io/novels';
const SERIES = SITE + '/data/series.json';
const UPDATES = SITE + '/data/update.json';
const WORKER = 'https://ranobevault-chapters.non-admin.workers.dev';
const PAGE_SIZE = 24;
const HEADERS = {
  Referer: 'https://ranobevault.github.io/',
  'x-referer': 'https://ranobevault.github.io/',
};
let seriesCache: Series[] | undefined;
let hashmapCache: Record<string, HashEntry> | undefined;

class RanobeVault implements Plugin.PluginBase {
  id = 'ranobevault';
  name = 'RanobeVault';
  version = '1.0.0';
  site = SITE;
  icon = 'src/en/ranobevault/icon.png';

  private async getSeries(): Promise<Series[]> {
    if (seriesCache) return seriesCache;
    const res = await fetchApi(SERIES);
    if (!res.ok) {
      throw new Error(`RanobeVault: HTTP ${res.status}.`);
    }
    const body: Series[] = await res.json();
    seriesCache = body;
    return body;
  }
  private async getChapterIndex(seriesId: string): Promise<ChapterItemJson[]> {
    const res = await fetchApi(
      `${WORKER}/index?series=${encodeURIComponent(seriesId)}`,
      { headers: HEADERS },
    );
    if (!res.ok) {
      throw new Error(`RanobeVault Chapter: HTTP ${res.status}.`);
    }
    const data: ChapterIndex = await res.json();
    return data.chapters;
  }
  private async getHashmap(): Promise<Record<string, HashEntry>> {
    if (hashmapCache) return hashmapCache;
    const res = await fetchApi(`${WORKER}/hashmap`, { headers: HEADERS });
    if (!res.ok) {
      throw new Error(`RanobeVault: HTTP ${res.status}.`);
    }
    const data: Record<string, HashEntry> = await res.json();
    hashmapCache = data;
    return data;
  }

  private escapeHtml(val: string) {
    return val
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels }: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    if (showLatestNovels) {
      const res = await fetchApi(UPDATES);
      if (!res.ok) {
        throw new Error(`RanobeVault: HTTP ${res.status}.`);
      }
      const novels: UpdateEntry[] = await res.json();
      return novels
        .filter(
          (novel, i, arr) =>
            arr.findIndex(nov => nov.series_id === novel.series_id) === i,
        )
        .slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE)
        .map(series => ({
          name: series.title,
          path: series.series_id,
          cover: series.cover,
        }));
    }
    const novels = await this.getSeries();
    return novels
      .slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE)
      .map(series => ({
        name: series.title,
        path: series.id,
        cover: series.cover,
      }));
  }
  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novel = (await this.getSeries()).find(
      series => series.id === novelPath,
    );
    if (!novel) throw new Error(`RanobeVault: novel "${novelPath}" not found.`);
    const chapterIndex = await this.getChapterIndex(novel.id);
    if (!chapterIndex.length)
      throw new Error('RanobeVault: no chapters were found.');
    const hashmap = await this.getHashmap();
    const chapters = chapterIndex
      .filter(c => hashmap[c.hash])
      .map((chapter, i) => ({
        name: chapter.title,
        path: hashmap[chapter.hash].file,
        chapterNumber: i + 1,
      }));
    return {
      name: novel.title,
      path: novelPath,
      cover: novel.cover ?? defaultCover,
      chapters: chapters,
      author: novel.author,
      summary: novel.synopsis,
      genres: novel.genres.join(', '),
      status: novel.status,
    };
  }
  async parseChapter(chapterPath: string): Promise<string> {
    const res = await fetchApi(
      `${WORKER}/chapter?file=${encodeURIComponent(chapterPath)}`,
      { headers: HEADERS },
    );
    if (!res.ok) throw new Error(`RanobeVault: HTTP ${res.status}.`);
    const data: ChapterData = await res.json();
    const html = data.content;
    if (!html.length)
      throw new Error('RanobeVault: chapter content was empty.');
    return html
      .map(str => {
        if (str.substring(0, 5) === '[img]') {
          return `<img src=${this.escapeHtml(str.slice(5))}>`;
        }
        return `<p>${this.escapeHtml(str)}</p>`;
      })
      .join('');
  }
  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const terms = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const matches = (await this.getSeries()).filter(novel =>
      terms.every(
        term =>
          novel.title.toLowerCase().includes(term) ||
          novel.synopsis.toLowerCase().includes(term) ||
          novel.genres.some(g => g.toLowerCase().includes(term)),
      ),
    );
    return matches
      .slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE)
      .map(series => ({
        name: series.title,
        path: series.id,
        cover: series.cover,
      }));
  }
}

export default new RanobeVault();
