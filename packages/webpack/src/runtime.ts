import { CompressedPrefetchGraph, CompressedGraphMap, PrefetchConfig } from './declarations';

class GraphNode {
  constructor(private _node: number[], private _map: CompressedGraphMap) {}

  get probability() {
    return this._node[0];
  }

  get route() {
    return this._map.routes[this._node[1]];
  }

  get chunk() {
    return this._map.chunks[this._node[2]];
  }
}

class Graph {
  constructor(private _graph: CompressedPrefetchGraph, private _map: CompressedGraphMap) {}

  findMatch(route: string): GraphNode[] {
    const result = this._graph.filter((_, i) => matchRoute(this._map.routes[i], route)).pop();
    if (!result) {
      return [];
    }
    return result.map(n => new GraphNode(n, this._map));
  }
}

const support = (feature: string) => {
  const fakeLink = document.createElement('link') as any;
  try {
    if (fakeLink.relList && typeof fakeLink.relList.supports === 'function') {
      return fakeLink.relList.supports(feature);
    }
  } catch (err) {
    return false;
  }
};

const linkPrefetchStrategy = (url: string) => {
  const link = document.createElement('link');
  link.setAttribute('rel', 'prefetch');
  link.setAttribute('href', url);
  const parentElement = document.getElementsByTagName('head')[0] || document.getElementsByName('script')[0].parentNode;
  parentElement.appendChild(link);
};

const importPrefetchStrategy = (url: string) => import(url);

const supportedPrefetchStrategy = support('prefetch') ? linkPrefetchStrategy : importPrefetchStrategy;

const preFetched: { [key: string]: boolean } = {};

const prefetch = (basePath: string, url: string) => {
  url = basePath + url;
  if (preFetched[url]) {
    return;
  }
  console.log('Pre-fetching', url);
  preFetched[url] = true;
  supportedPrefetchStrategy(url);
};

const matchRoute = (route: string, declaration: string) => {
  const routeParts = route.split('/');
  const declarationParts = declaration.split('/');
  if (routeParts.length > 0 && routeParts[routeParts.length - 1] === '') {
    routeParts.pop();
  }

  if (declarationParts.length > 0 && declarationParts[declarationParts.length - 1] === '') {
    declarationParts.pop();
  }

  if (routeParts.length !== declarationParts.length) {
    return false;
  } else {
    return declarationParts.reduce((a, p, i) => {
      if (p.startsWith(':')) {
        return a;
      }
      return a && p === routeParts[i];
    }, true);
  }
};

const polyfillConnection = {
  effectiveType: '3g'
};
const handleNavigationChange = (graph: Graph, basePath: string, thresholds: PrefetchConfig, route: string) => {
  const nodes = graph.findMatch(route);
  if (!nodes) {
    return;
  }
  const c = (navigator as any).connection || polyfillConnection;
  const threshold = (thresholds as any)[c.effectiveType];
  for (const node of nodes) {
    if (node.probability < threshold || preFetched[node.chunk]) {
      continue;
    }
    if (node.chunk) {
      prefetch(basePath, node.chunk);
    }
  }
};

export interface LinkProbabilities {
  [key: string]: number;
}

const scoreRoute = (graph: Graph, current: string, links: string[]): LinkProbabilities => {
  const matches = graph.findMatch(current);
  return links.reduce((result: LinkProbabilities, link: string) => {
    const node = matches.filter(m => matchRoute(link, m.route)).pop();
    if (node) {
      result[link] = node.probability;
    }
    return result;
  }, {});
};

export let score = (current: string, links: string[]): LinkProbabilities => {
  throw new Error('Guess is not initialized');
};

export const initialize = (
  history: History,
  compressed: CompressedPrefetchGraph,
  map: CompressedGraphMap,
  basePath: string,
  thresholds: PrefetchConfig,
  delegate: boolean
) => {
  const graph = new Graph(compressed, map);
  score = (current: string, links: string[]) => scoreRoute(graph, current, links);

  if (delegate) {
    return;
  }

  window.addEventListener('popstate', e => handleNavigationChange(graph, basePath, thresholds, location.pathname));

  const pushState = history.pushState;
  history.pushState = function(state) {
    if (typeof (history as any).onpushstate === 'function') {
      (history as any).onpushstate({ state: state });
    }
    handleNavigationChange(graph, basePath, thresholds, arguments[2]);
    return pushState.apply(history, arguments);
  };
};
