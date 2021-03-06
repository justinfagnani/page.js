import pathtoRegexp from './path-to-regex.js';

/**
 * Detect click event
 */
const clickEvent = document.ontouchstart ? 'touchstart' : 'click';

export type Callback = (context: Context, next: () => void) => void;

export interface PageOptions {
  window?: Window;
  decodeURLComponents?: boolean;
  popstate?: boolean;
  click?: boolean;
  hashbang?: boolean;
}

export interface StartOptions {
  /**
   * bind to click events [true]
   */
  click?: boolean;

  /**
   * bind to popstate [true]
   */
  popstate?: boolean;

  /**
   * perform initial dispatch [true]
   */
  dispatch?: boolean;

  hashbang?: boolean;

  window?: Window;
}

let windowLoaded = document.readyState === 'complete';
if (!windowLoaded) {
  window.addEventListener('load', () =>
    setTimeout(() => (windowLoaded = true), 0)
  );
}

/**
 * The page instance
 */
export class Page {
  callbacks: Callback[] = [];
  exits: Callback[] = [];
  current = '';
  len = 0;

  private _decodeURLComponents = true;
  private _base = '';
  _strict = false; /* Read by Route */
  private _running = false;
  _hashbang = false; /* Read by Context */
  _window!: Window; /* Read by Context */
  private _popstate!: boolean;
  private _click!: boolean;

  private prevContext?: Context;

  /**
   * Configure the instance of page. This can be called multiple times.
   */
  configure(options: PageOptions) {
    const opts = options || {};

    this._window = opts.window || window;
    this._decodeURLComponents = opts.decodeURLComponents !== false;
    this._popstate = opts.popstate !== false;
    this._click = opts.click !== false;
    this._hashbang = !!opts.hashbang;

    const _window = this._window;
    if (this._popstate) {
      _window.addEventListener('popstate', this._onpopstate, false);
    } else {
      _window.removeEventListener('popstate', this._onpopstate, false);
    }

    if (this._click) {
      _window.document.addEventListener(clickEvent, this.clickHandler, false);
    } else {
      _window.document.removeEventListener(
        clickEvent,
        this.clickHandler,
        false
      );
    }

    _window.removeEventListener('hashchange', this._onpopstate, false);
  }

  /**
   * The basepath of the Page instance.
   */
  get base() {
    return this._base;
  }

  set base(path: string) {
    this._base = path;
  }

  /**
   * Gets the `base`, which depends on whether we are using History or
   * hashbang routing.
   */
  _getBase() {
    let base = this._base;
    if (base) {
      return base;
    }
    const loc = this._window && this._window.location;

    if (this._hashbang && loc && loc.protocol === 'file:') {
      base = loc.pathname;
    }

    return base;
  }

  /**
   * Whether strict path matching is enabled.
   */
  get strict() {
    return this._strict;
  }

  set strict(enable: boolean) {
    this._strict = enable;
  }

  /**
   * Bind with the given `options`.
   *
   * Options:
   *   - `click` bind to click events [true]
   *   - `popstate` bind to popstate [true]
   *   - `dispatch` perform initial dispatch [true]
   */
  start(options: StartOptions) {
    const opts = options || {};
    this.configure(opts);

    if (false === opts.dispatch) return;
    this._running = true;

    let url;
    const window = this._window;
    const loc = window.location;

    if (this._hashbang && ~loc.hash.indexOf('#!')) {
      url = loc.hash.substr(2) + loc.search;
    } else if (this._hashbang) {
      url = loc.search + loc.hash;
    } else {
      url = loc.pathname + loc.search + loc.hash;
    }

    this.replace(url, undefined, true, opts.dispatch);
  }

  /**
   * Unbind click and popstate event handlers.
   */
  stop() {
    if (!this._running) return;
    this.current = '';
    this.len = 0;
    this._running = false;

    const window = this._window;
    this._click &&
      window.document.removeEventListener(clickEvent, this.clickHandler, false);
    window.removeEventListener('popstate', this._onpopstate, false);
    window.removeEventListener('hashchange', this._onpopstate, false);
  }

  route(callback: Callback): void;
  route(path: string | RegExp, ...callbacks: Callback[]): void;
  route(
    pathOrCallback: string | RegExp | Callback,
    ...callbacks: Callback[]
  ): void {
    const path = typeof pathOrCallback === 'function' ? '*' : pathOrCallback;
    if (typeof pathOrCallback === 'function') {
      callbacks.push(pathOrCallback);
    }
    const route = new Route(path, undefined, this);
    for (const callback of callbacks) {
      this.callbacks.push(route.middleware(callback));
    }
  }

  /**
   * Show `path` with optional `state` object.
   */
  show(
    path: string,
    state?: State,
    dispatch?: boolean,
    push?: boolean
  ): Context {
    const context = new Context(path, state, this);
    const prev = this.prevContext;

    this.prevContext = context;
    this.current = context.path;
    if (false !== dispatch) {
      this.dispatch(context, prev);
    }
    if (false !== context.handled && false !== push) {
      context.pushState();
    }
    return context;
  }

  /**
   * Goes back in the history
   * Back should always let the current route push state and then go back.
   *
   * @param path - fallback path to go back if no more history exists, if undefined defaults to page.base
   */
  back(path?: string, state?: State) {
    const page = this;
    if (this.len > 0) {
      // this may need more testing to see if all browsers
      // wait for the next tick to go back in history
      this._window.history.back();
      this.len--;
    } else if (path) {
      setTimeout(() => this.show(path, state));
    } else {
      setTimeout(() => this.show(page._getBase(), state));
    }
  }

  /**
   * Register route to redirect from one path to other
   * or just redirect to another route
   *
   * @param from - if param 'to' is undefined redirects to 'from'
   */
  redirect(from: string, to?: string) {
    // Define route from a path to another
    if ('string' === typeof from && 'string' === typeof to) {
      this.route(from, () => setTimeout(() => this.replace(to), 0));
    }

    // Wait for the push state and replace it with another
    if ('string' === typeof from && 'undefined' === typeof to) {
      setTimeout(() => this.replace(from), 0);
    }
  }

  /**
   * Replace `path` with optional `state` object.
   */
  replace(path: string, state?: State, init?: boolean, dispatch?: boolean) {
    const context = new Context(path, state, this);
    const prev = this.prevContext;
    this.prevContext = context;
    this.current = context.path;
    context.init = init;

    // save before dispatching, which may redirect
    context.save();
    if (false !== dispatch) {
      this.dispatch(context, prev);
    }
    return context;
  }

  /**
   * Dispatch the given `context`.
   */
  dispatch(context: Context, prev?: Context) {
    let i = 0;
    let j = 0;

    const nextExit = () => {
      const fn = this.exits[j++];
      if (!fn) {
        return nextEnter();
      }
      fn(prev!, nextExit);
    };

    const nextEnter = () => {
      const fn = this.callbacks[i++];

      if (context.path !== this.current) {
        context.handled = false;
        return;
      }
      if (!fn) {
        return this.unhandled(context);
      }
      fn(context, nextEnter);
    };

    if (prev) {
      nextExit();
    } else {
      nextEnter();
    }
  }

  /**
   * Register an exit route on `path` with
   * callback `fn()`, which will be called
   * on the previous context when a new
   * page is visited.
   */
  exit(path: string, ...exits: Callback[]): void;
  exit(fn: Callback): void;
  exit(pathOrCallback: string | Callback, ...exits: Callback[]): void {
    const path = typeof pathOrCallback === 'function' ? '*' : pathOrCallback;
    if (typeof pathOrCallback === 'function') {
      exits.push(pathOrCallback);
    }

    const route = new Route(path, undefined, this);
    for (const exit of exits) {
      this.exits.push(route.middleware(exit));
    }
  }

  /**
   * Handle "click" events.
   */
  clickHandler = (e: MouseEvent | TouchEvent) => {
    if (
      e.defaultPrevented ||
      (e as MouseEvent).button !== 1 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey
    ) {
      return;
    }

    // ensure link
    // use shadow dom when available if not, fall back to composedPath()
    // for browsers that only have shady
    let el = e.target as Element;

    // TODO: this appears to be entirely untested
    if ('composedPath' in e) {
      for (const node of e.composedPath()) {
        if (!(node as Node).nodeName) continue;
        if ((node as Element).nodeName.toUpperCase() !== 'A') continue;
        if (!(node as HTMLAnchorElement).href) continue;

        el = node as HTMLAnchorElement;
        break;
      }
    }

    // continue ensure link
    // el.nodeName for svg links are 'a' instead of 'A'
    while (el && 'A' !== el.nodeName.toUpperCase()) {
      el = el.parentNode as Element;
    }
    const isAnchor = (e: Element): e is HTMLAnchorElement | SVGAElement =>
      e !== undefined && e.nodeName.toUpperCase() === 'A';

    if (!isAnchor(el)) {
      return;
    }

    // check if link is inside an svg
    // in this case, both href and target are always inside an object
    const svg =
      typeof el.href === 'object' &&
      el.href.constructor.name === 'SVGAnimatedString';

    // Ignore if tag has
    // 1. "download" attribute
    // 2. rel="external" attribute
    if (el.hasAttribute('download') || el.getAttribute('rel') === 'external') {
      return;
    }

    // ensure non-hash for the same path
    const link = el.getAttribute('href');
    if (
      !this._hashbang &&
      this._samePath(el) &&
      ((el as HTMLAnchorElement).hash || '#' === link)
    ) {
      return;
    }

    // Check for mailto: in the href
    if (link && link.includes('mailto:')) {
      return;
    }

    // check target
    // svg target is an object and its desired value is in .baseVal property
    if (svg ? (el as SVGAElement).target.baseVal : el.target) {
      return;
    }

    // x-origin
    // note: svg links that are not relative don't call click events (and skip page.js)
    // consequently, all svg links tested inside page.js are relative and in the same origin
    if (!svg && !this.sameOrigin((el as HTMLAnchorElement).href)) {
      return;
    }

    // rebuild path
    // There aren't .pathname and .search properties in svg links, so we use href
    // Also, svg href is an object and its desired value is in .baseVal property
    let path = svg
      ? (el as SVGAElement).href.baseVal
      : (el as HTMLAnchorElement).pathname +
        (el as HTMLAnchorElement).search +
        ((el as HTMLAnchorElement).hash || '');

    path = !path.startsWith('/') ? '/' + path : path;

    // same page
    const orig = path;
    const pageBase = this._getBase();

    if (path.startsWith(pageBase)) {
      path = path.substr(pageBase.length);
    }

    if (this._hashbang) {
      path = path.replace('#!', '');
    }

    if (
      pageBase &&
      orig === path &&
      this._window.location.protocol !== 'file:'
    ) {
      return;
    }

    e.preventDefault();
    this.show(orig);
  };

  /**
   * Handle "populate" events.
   */
  private _onpopstate = (e: PopStateEvent | HashChangeEvent) => {
    if (!windowLoaded) {
      return;
    }
    if ((e as PopStateEvent).state) {
      const path = (e as PopStateEvent).state.path;
      this.replace(path, (e as PopStateEvent).state);
    } else {
      const loc = this._window.location;
      this.show(
        loc.pathname + loc.search + loc.hash,
        undefined,
        undefined,
        false
      );
    }
  };

  /**
   * Check if `href` is the same origin.
   */
  sameOrigin(href?: string): boolean {
    if (href === undefined) {
      return false;
    }

    const url = new URL(href, this._window.location.toString());
    const loc = this._window.location;
    /*
        when the port is the default http port 80, internet explorer 11
        returns an empty string for loc.port, so we need to compare loc.port
        with an empty string if url.port is the default port 80.
    */
    return (
      loc.protocol === url.protocol &&
      loc.hostname === url.hostname &&
      (loc.port === url.port || (loc.port === '' && url.port === '80'))
    );
  }

  private _samePath(url: HTMLAnchorElement | SVGAElement) {
    const loc = this._window.location;
    return (
      (url as any).pathname === loc.pathname &&
      (url as any).search === loc.search
    );
  }

  /**
   * Remove URL encoding from the given `str`.
   * Accommodates whitespace in both x-www-form-urlencoded
   * and regular percent-encoded form.
   *
   * @param val - URL component to decode
   */
  _decodeURLEncodedURIComponent(val: string) {
    if (typeof val !== 'string') {
      return val;
    }
    return this._decodeURLComponents
      ? decodeURIComponent(val.replace(/\+/g, ' '))
      : val;
  }

  /**
   * Unhandled `ctx`. When it's not the initial
   * popstate then redirect. If you wish to handle
   * 404s on your own use `page('*', callback)`.
   */
  unhandled(ctx: Context) {
    if (ctx.handled) {
      return;
    }
    let current: string;
    const window = this._window;

    if (this._hashbang) {
      current = this._getBase() + window.location.hash.replace('#!', '');
    } else {
      current = window.location.pathname + window.location.search;
    }

    if (current === ctx.canonicalPath) {
      return;
    }
    this.stop();
    ctx.handled = false;
    window.location.href = ctx.canonicalPath;
  }
}

/**
 * Escapes RegExp characters in the given string.
 * TODO: import from path-to-regex
 */
const escapeRegExp = (s: string) =>
  s.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');

export interface State {
  path?: string;
}

/**
 * Initialize a new "request" `Context`
 * with the given `path` and optional initial `state`.
 */
export class Context {
  init?: boolean;
  handled?: boolean;
  page: Page;
  canonicalPath: string;
  path: string;
  title: string;
  state: any;
  querystring: string;
  pathname: string;
  params: any;
  hash: string;

  constructor(path: string, state?: State, page: Page = globalPage) {
    this.page = page;
    const window = page._window;
    const hashbang = page._hashbang;

    const pageBase = page._getBase();
    if (path.startsWith('/') && !path.startsWith(pageBase)) {
      path = pageBase + (hashbang ? '#!' : '') + path;
    }
    const i = path.indexOf('?');

    this.canonicalPath = path;
    const re = new RegExp('^' + escapeRegExp(pageBase));
    this.path = path.replace(re, '') || '/';
    if (hashbang) {
      this.path = this.path.replace('#!', '') || '/';
    }

    this.title = window.document.title;
    this.state = state || {};
    this.state.path = path;
    this.querystring = ~i
      ? page._decodeURLEncodedURIComponent(path.slice(i + 1))
      : '';
    this.pathname = page._decodeURLEncodedURIComponent(
      ~i ? path.slice(0, i) : path
    );
    this.params = {};

    // fragment
    this.hash = '';
    if (!hashbang) {
      if (!~this.path.indexOf('#')) {
        return;
      }
      const parts = this.path.split('#');
      this.path = this.pathname = parts[0];
      this.hash = page._decodeURLEncodedURIComponent(parts[1]) || '';
      this.querystring = this.querystring.split('#')[0];
    }
  }

  /**
   * Push state.
   *
   * @api private
   */

  pushState() {
    const page = this.page;
    const window = page._window;
    const hashbang = page._hashbang;

    page.len++;
    window.history.pushState(
      this.state,
      this.title,
      hashbang && this.path !== '/' ? '#!' + this.path : this.canonicalPath
    );
  }

  /**
   * Save the context state.
   *
   * @api public
   */

  save() {
    const page = this.page;
    page._window.history.replaceState(
      this.state,
      this.title,
      page._hashbang && this.path !== '/'
        ? '#!' + this.path
        : this.canonicalPath
    );
  }
}

export interface RouteOptions {
  /**
   * enable case-sensitive routes
   */
  sensitive?: boolean;

  /**
   * enable strict matching for trailing slashes
   */
  strict?: boolean;
}

/**
 * Initialize `Route` with the given HTTP `path`,
 * and an array of `callbacks` and `options`.
 *
 * Options:
 *   - `sensitive`    enable case-sensitive routes
 *   - `strict`       enable strict matching for trailing slashes
 */
class Route {
  page: Page;
  path: string | RegExp;
  method: 'GET';
  regexp: RegExp;
  keys: Array<{name: string}>;

  constructor(
    path: string | RegExp,
    options?: RouteOptions,
    page: Page = globalPage
  ) {
    this.page = page || globalPage;
    const opts = options || {};
    opts.strict = opts.strict || page._strict;
    this.path = path === '*' ? '(.*)' : path;
    this.method = 'GET';
    this.regexp = pathtoRegexp(this.path, (this.keys = []), opts);
  }

  /**
   * Return route middleware with the given callback `fn()`.
   */
  middleware(fn: Callback): Callback {
    return (ctx, next) => {
      if (this.match(ctx.path, ctx.params)) {
        return fn(ctx, next);
      }
      next();
    };
  }

  /**
   * Check if this route matches `path`, if so
   * populate `params`.
   */
  private match(path: string, params: any): boolean {
    const keys = this.keys;
    const qsIndex = path.indexOf('?');
    const pathname = ~qsIndex ? path.slice(0, qsIndex) : path;
    const m = this.regexp.exec(decodeURIComponent(pathname));

    delete params[0];

    if (!m) {
      return false;
    }

    for (let i = 1; i < m.length; ++i) {
      const key = keys[i - 1];
      const val = this.page._decodeURLEncodedURIComponent(m[i]);
      if (val !== undefined || !params.hasOwnProperty(key.name)) {
        params[key.name] = val;
      }
    }
    return true;
  }
}

export const globalPage = new Page(); //createPage();
export default globalPage;
