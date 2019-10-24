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
}

/**
 * The page instance
 */
export class Page {
  callbacks: Callback[] = [];
  exits = [];
  current = '';
  len = 0;

  private _decodeURLComponents = true;
  private _base = '';
  private _strict = false;
  private _running = false;
  _hashbang = false; /* Read by Context */
  _window: Window; /* Read by Context */
  private _popstate: boolean;
  private _click: boolean;

  private prevContext: Context;

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
    if(this._popstate) {
      _window.addEventListener('popstate', this._onpopstate, false);
    } else {
      _window.removeEventListener('popstate', this._onpopstate, false);
    }

    if (this._click) {
      _window.document.addEventListener(clickEvent, this.clickHandler, false);
    } else {
      _window.document.removeEventListener(clickEvent, this.clickHandler, false);
    }

    _window.removeEventListener('hashchange', this._onpopstate, false);
  }

  /**
   * Get or set basepath to `path`.
   */
  base(path?: string) {
    if (0 === arguments.length) return this._base;
    this._base = path;
  }

  /**
   * Gets the `base`, which depends on whether we are using History or
   * hashbang routing.
   */
  _getBase() {
    var base = this._base;
    if(!!base) return base;
    var loc = this._window && this._window.location;

    if(this._hashbang && loc && loc.protocol === 'file:') {
      base = loc.pathname;
    }

    return base;
  }

  /**
   * Get or set strict path matching to `enable`
   */
  strict(enable?: boolean) {
    if (0 === arguments.length) return this._strict;
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

    if(this._hashbang && ~loc.hash.indexOf('#!')) {
      url = loc.hash.substr(2) + loc.search;
    } else if (this._hashbang) {
      url = loc.search + loc.hash;
    } else {
      url = loc.pathname + loc.search + loc.hash;
    }

    this.replace(url, null, true, opts.dispatch);
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
    this._click && window.document.removeEventListener(clickEvent, this.clickHandler, false);
    window.removeEventListener('popstate', this._onpopstate, false);
    window.removeEventListener('hashchange', this._onpopstate, false);
  }

  route(callback: Function): void;
  route(path: string, ...callbacks: Function[]): void;
  route(pathOrCallback: string | Function, ...callbacks: Function[]): void {
    const path = (typeof pathOrCallback === 'function') ? '*' : pathOrCallback;
    if (typeof pathOrCallback === 'function') {
      callbacks.push(pathOrCallback);
    }
    const route = new Route(path, null, this);
    for (const callback of callbacks) {
      this.callbacks.push(route.middleware(callback));
    }
  }

  /**
   * Show `path` with optional `state` object.
   */
  show(path: string, state?: unknown, dispatch?: boolean, push?: boolean): Context {
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
  back(path?: string, state?: unknown) {
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
  replace(path: string, state?: unknown, init?: boolean, dispatch?: boolean) {
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
      fn(prev, nextExit);
    }

    const nextEnter = () => {
      const fn = this.callbacks[i++];

      if (context.path !== this.current) {
        context.handled = false;
        return;
      }
      if (!fn) {
        return unhandled.call(this, context);
      }
      fn(context, nextEnter);
    }

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
  exit(path, fn) {
    if (typeof path === 'function') {
      return this.exit('*', path);
    }

    var route = new Route(path, null, this);
    for (var i = 1; i < arguments.length; ++i) {
      this.exits.push(route.middleware(arguments[i]));
    }
  }

  create() {
    return new Page();
  }

  /**
   * Handle "click" events.
   */
  clickHandler = (e) => {
    if (1 !== this._which(e)) return;

    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.defaultPrevented) return;

    // ensure link
    // use shadow dom when available if not, fall back to composedPath()
    // for browsers that only have shady
    var el = e.target;
    var eventPath = e.path || (e.composedPath ? e.composedPath() : null);

    if(eventPath) {
      for (var i = 0; i < eventPath.length; i++) {
        if (!eventPath[i].nodeName) continue;
        if (eventPath[i].nodeName.toUpperCase() !== 'A') continue;
        if (!eventPath[i].href) continue;

        el = eventPath[i];
        break;
      }
    }

    // continue ensure link
    // el.nodeName for svg links are 'a' instead of 'A'
    while (el && 'A' !== el.nodeName.toUpperCase()) el = el.parentNode;
    if (!el || 'A' !== el.nodeName.toUpperCase()) return;

    // check if link is inside an svg
    // in this case, both href and target are always inside an object
    var svg = (typeof el.href === 'object') && el.href.constructor.name === 'SVGAnimatedString';

    // Ignore if tag has
    // 1. "download" attribute
    // 2. rel="external" attribute
    if (el.hasAttribute('download') || el.getAttribute('rel') === 'external') return;

    // ensure non-hash for the same path
    var link = el.getAttribute('href');
    if(!this._hashbang && this._samePath(el) && (el.hash || '#' === link)) return;

    // Check for mailto: in the href
    if (link && link.indexOf('mailto:') > -1) return;

    // check target
    // svg target is an object and its desired value is in .baseVal property
    if (svg ? el.target.baseVal : el.target) return;

    // x-origin
    // note: svg links that are not relative don't call click events (and skip page.js)
    // consequently, all svg links tested inside page.js are relative and in the same origin
    if (!svg && !this.sameOrigin(el.href)) return;

    // rebuild path
    // There aren't .pathname and .search properties in svg links, so we use href
    // Also, svg href is an object and its desired value is in .baseVal property
    var path = svg ? el.href.baseVal : (el.pathname + el.search + (el.hash || ''));

    path = path[0] !== '/' ? '/' + path : path;

    // same page
    var orig = path;
    var pageBase = this._getBase();

    if (path.indexOf(pageBase) === 0) {
      path = path.substr(pageBase.length);
    }

    if (this._hashbang) path = path.replace('#!', '');

    if (pageBase && orig === path && (this._window.location.protocol !== 'file:')) {
      return;
    }

    e.preventDefault();
    this.show(orig);
  }

  /**
   * Handle "populate" events.
   * @api private
   */
  _onpopstate = (() => {
    var loaded = false;
    if (document.readyState === 'complete') {
      loaded = true;
    } else {
      window.addEventListener('load', function() {
        setTimeout(function() {
          loaded = true;
        }, 0);
      });
    }
    return (e) => {
      if (!loaded) return;
      // var page = this;
      if (e.state) {
        var path = e.state.path;
        this.replace(path, e.state);
      } else {
        var loc = this._window.location;
        this.show(loc.pathname + loc.search + loc.hash, undefined, undefined, false);
      }
    };
  })();

  /**
   * Event button.
   */
  _which(e) {
    e = e || this._window.event;
    return null == e.which ? e.button : e.which;
  }

  /**
   * Convert to a URL object
   * @api private
   */
  _toURL(href) {
    var window = this._window;
    if(typeof URL === 'function') {
      return new URL(href, window.location.toString());
    } else {
      var anc = window.document.createElement('a');
      anc.href = href;
      return anc;
    }
  }

  /**
   * Check if `href` is the same origin.
   * @param {string} href
   * @api public
   */
  sameOrigin(href) {
    if(!href) return false;

    var url = this._toURL(href);
    var window = this._window;

    var loc = window.location;
    /*
        when the port is the default http port 80, internet explorer 11
        returns an empty string for loc.port, so we need to compare loc.port
        with an empty string if url.port is the default port 80.
    */
    return loc.protocol === url.protocol &&
      loc.hostname === url.hostname &&
      (loc.port === url.port || loc.port === '' && url.port === '80');
  }

  /**
   * @api private
   */
  _samePath(url) {
    var window = this._window;
    var loc = window.location;
    return url.pathname === loc.pathname &&
      url.search === loc.search;
  }

  /**
   * Remove URL encoding from the given `str`.
   * Accommodates whitespace in both x-www-form-urlencoded
   * and regular percent-encoded form.
   *
   * @param {string} val - URL component to decode
   * @api private
   */
  _decodeURLEncodedURIComponent(val) {
    if (typeof val !== 'string') { return val; }
    return this._decodeURLComponents ? decodeURIComponent(val.replace(/\+/g, ' ')) : val;
  }
}

/**
 * Unhandled `ctx`. When it's not the initial
 * popstate then redirect. If you wish to handle
 * 404s on your own use `page('*', callback)`.
 *
 * @param {Context} ctx
 * @api private
 */
function unhandled(ctx) {
  if (ctx.handled) return;
  var current;
  var page = this;
  var window = page._window;

  if (page._hashbang) {
    current = this._getBase() + window.location.hash.replace('#!', '');
  } else {
    current = window.location.pathname + window.location.search;
  }

  if (current === ctx.canonicalPath) return;
  page.stop();
  ctx.handled = false;
  window.location.href = ctx.canonicalPath;
}

/**
 * Escapes RegExp characters in the given string.
 *
 * @param {string} s
 * @api private
 */
function escapeRegExp(s) {
  return s.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');
}

/**
 * Initialize a new "request" `Context`
 * with the given `path` and optional initial `state`.
 *
 * @constructor
 * @param {string} path
 * @param {Object=} state
 * @api public
 */

export class Context {

  init;
  handled;
  page: Page;
  canonicalPath;
  path;
  title;
  state;
  querystring;
  pathname;
  params;
  hash;

  constructor(path, state, pageInstance) {
    var _page = this.page = pageInstance || globalPage;
    var window = _page._window;
    var hashbang = _page._hashbang;

    var pageBase = _page._getBase();
    if ('/' === path[0] && 0 !== path.indexOf(pageBase)) path = pageBase + (hashbang ? '#!' : '') + path;
    var i = path.indexOf('?');

    this.canonicalPath = path;
    var re = new RegExp('^' + escapeRegExp(pageBase));
    this.path = path.replace(re, '') || '/';
    if (hashbang) this.path = this.path.replace('#!', '') || '/';

    this.title = window.document.title;
    this.state = state || {};
    this.state.path = path;
    this.querystring = ~i ? _page._decodeURLEncodedURIComponent(path.slice(i + 1)) : '';
    this.pathname = _page._decodeURLEncodedURIComponent(~i ? path.slice(0, i) : path);
    this.params = {};

    // fragment
    this.hash = '';
    if (!hashbang) {
      if (!~this.path.indexOf('#')) return;
      var parts = this.path.split('#');
      this.path = this.pathname = parts[0];
      this.hash = _page._decodeURLEncodedURIComponent(parts[1]) || '';
      this.querystring = this.querystring.split('#')[0];
    }
  }

  /**
   * Push state.
   *
   * @api private
   */

  pushState() {
    var page = this.page;
    var window = page._window;
    var hashbang = page._hashbang;

    page.len++;
    window.history.pushState(this.state, this.title,
      hashbang && this.path !== '/' ? '#!' + this.path : this.canonicalPath);
  }

  /**
   * Save the context state.
   *
   * @api public
   */

  save() {
    var page = this.page;
    page._window.history.replaceState(this.state, this.title,
      page._hashbang && this.path !== '/' ? '#!' + this.path : this.canonicalPath);
  }
}

/**
 * Initialize `Route` with the given HTTP `path`,
 * and an array of `callbacks` and `options`.
 *
 * Options:
 *
 *   - `sensitive`    enable case-sensitive routes
 *   - `strict`       enable strict matching for trailing slashes
 *
 * @constructor
 * @param {string} path
 * @param {Object=} options
 * @api private
 */
class Route {

  page;
  path;
  method;
  regexp;
  keys;

  constructor(path, options, page) {
    var _page = this.page = page || globalPage;
    var opts = options || {};
    opts.strict = opts.strict || page._strict;
    this.path = (path === '*') ? '(.*)' : path;
    this.method = 'GET';
    this.regexp = pathtoRegexp(this.path, this.keys = [], opts);
  }

  /**
   * Return route middleware with
   * the given callback `fn()`.
   *
   * @param {Function} fn
   * @return {Function}
   * @api public
   */
  middleware(fn) {
    var self = this;
    return function(ctx, next) {
      if (self.match(ctx.path, ctx.params)) return fn(ctx, next);
      next();
    };
  }

  /**
   * Check if this route matches `path`, if so
   * populate `params`.
   *
   * @param {string} path
   * @param {Object} params
   * @return {boolean}
   * @api private
   */
  match(path, params) {
    var keys = this.keys,
      qsIndex = path.indexOf('?'),
      pathname = ~qsIndex ? path.slice(0, qsIndex) : path,
      m = this.regexp.exec(decodeURIComponent(pathname));

    delete params[0]

    if (!m) return false;

    for (var i = 1, len = m.length; i < len; ++i) {
      var key = keys[i - 1];
      var val = this.page._decodeURLEncodedURIComponent(m[i]);
      if (val !== undefined || !(params.hasOwnProperty(key.name))) {
        params[key.name] = val;
      }
    }

    return true;
  }
}

export const globalPage = new Page(); //createPage();
export default globalPage;
