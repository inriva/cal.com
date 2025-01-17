import { useRouter } from "next/router";
import { useState, useEffect, CSSProperties } from "react";

import { sdkActionManager } from "./sdk-event";

export interface UiConfig {
  theme: string;
  styles: EmbedStyles;
}

const embedStore = {
  // Store all embed styles here so that as and when new elements are mounted, styles can be applied to it.
  styles: {},
  namespace: null,
  theme: null,
  // Store all React State setters here.
  reactStylesStateSetters: {},
  parentInformedAboutContentHeight: false,
  windowLoadEventFired: false,
} as {
  styles: UiConfig["styles"];
  namespace: string | null;
  theme: string | null;
  reactStylesStateSetters: any;
  parentInformedAboutContentHeight: boolean;
  windowLoadEventFired: boolean;
};

let isSafariBrowser = false;
const isBrowser = typeof window !== "undefined";

if (isBrowser) {
  const ua = navigator.userAgent.toLowerCase();
  isSafariBrowser = ua.includes("safari") && !ua.includes("chrome");
  if (isSafariBrowser) {
    log("Safari Detected: Using setTimeout instead of rAF");
  }
}

function runAsap(fn: (...arg: any) => void) {
  if (isSafariBrowser) {
    // https://adpiler.com/blog/the-full-solution-why-do-animations-run-slower-in-safari/
    return setTimeout(fn, 50);
  }
  return requestAnimationFrame(fn);
}

declare global {
  interface Window {
    CalEmbed: {
      __logQueue?: any[];
    };
    CalComPageStatus: string;
    CalComPlan: string;
  }
}

function log(...args: any[]) {
  if (isBrowser) {
    const namespace = getNamespace();

    const searchParams = new URL(document.URL).searchParams;
    //TODO: Send postMessage to parent to get all log messages in the same queue.
    window.CalEmbed = window.CalEmbed || {};
    const logQueue = (window.CalEmbed.__logQueue = window.CalEmbed.__logQueue || []);
    args.push({
      ns: namespace,
      url: document.URL,
    });
    args.unshift("CAL:");
    logQueue.push(args);
    if (searchParams.get("debug")) {
      console.log(...args);
    }
  }
}

// Only allow certain styles to be modified so that when we make any changes to HTML, we know what all embed styles might be impacted.
// Keep this list to minimum, only adding those styles which are really needed.
interface EmbedStyles {
  body?: Pick<CSSProperties, "background">;
  eventTypeListItem?: Pick<CSSProperties, "background" | "color" | "backgroundColor">;
  enabledDateButton?: Pick<CSSProperties, "background" | "color" | "backgroundColor">;
  disabledDateButton?: Pick<CSSProperties, "background" | "color" | "backgroundColor">;
  availabilityDatePicker?: Pick<CSSProperties, "background" | "color" | "backgroundColor">;
}
interface EmbedStylesBranding {
  branding?: {
    brandColor?: string;
    lightColor?: string;
    lighterColor?: string;
    lightestColor?: string;
    highlightColor?: string;
    darkColor?: string;
    darkerColor?: string;
    medianColor?: string;
  };
}

type ReactEmbedStylesSetter = React.Dispatch<React.SetStateAction<EmbedStyles | EmbedStylesBranding>>;

const setEmbedStyles = (stylesConfig: UiConfig["styles"]) => {
  embedStore.styles = stylesConfig;
  for (let [, setEmbedStyle] of Object.entries(embedStore.reactStylesStateSetters)) {
    (setEmbedStyle as any)((styles: any) => {
      return {
        ...styles,
        ...stylesConfig,
      };
    });
  }
};

const registerNewSetter = (elementName: keyof EmbedStyles | keyof EmbedStylesBranding, setStyles: any) => {
  embedStore.reactStylesStateSetters[elementName] = setStyles;
  // It's possible that 'ui' instruction has already been processed and the registration happened due to some action by the user in iframe.
  // So, we should call the setter immediately with available embedStyles
  setStyles(embedStore.styles);
};

const removeFromEmbedStylesSetterMap = (elementName: keyof EmbedStyles | keyof EmbedStylesBranding) => {
  delete embedStore.reactStylesStateSetters[elementName];
};

function isValidNamespace(ns: string | null | undefined) {
  return typeof ns !== "undefined" && ns !== null;
}

export const useEmbedTheme = () => {
  const router = useRouter();
  if (embedStore.theme) {
    return embedStore.theme;
  }
  const theme = (embedStore.theme = router.query.theme as string);
  return theme;
};

// TODO: Make it usable as an attribute directly instead of styles value. It would allow us to go beyond styles e.g. for debugging we can add a special attribute indentifying the element on which UI config has been applied
export const useEmbedStyles = (elementName: keyof EmbedStyles) => {
  const [styles, setStyles] = useState({} as EmbedStyles);

  useEffect(() => {
    registerNewSetter(elementName, setStyles);
    // It's important to have an element's embed style be required in only one component. If due to any reason it is required in multiple components, we would override state setter.
    return () => {
      // Once the component is unmounted, we can remove that state setter.
      removeFromEmbedStylesSetterMap(elementName);
    };
  }, []);

  return styles[elementName] || {};
};

export const useEmbedBranding = (elementName: keyof EmbedStylesBranding) => {
  const [styles, setStyles] = useState({} as EmbedStylesBranding);

  useEffect(() => {
    registerNewSetter(elementName, setStyles);
    // It's important to have an element's embed style be required in only one component. If due to any reason it is required in multiple components, we would override state setter.
    return () => {
      // Once the component is unmounted, we can remove that state setter.
      removeFromEmbedStylesSetterMap(elementName);
    };
  }, []);

  return styles[elementName] || {};
};

export const useIsBackgroundTransparent = () => {
  let isBackgroundTransparent = false;
  // TODO: Background should be read as ui.background and not ui.body.background
  const bodyEmbedStyles = useEmbedStyles("body");

  if (bodyEmbedStyles?.background === "transparent") {
    isBackgroundTransparent = true;
  }
  return isBackgroundTransparent;
};

export const useBrandColors = () => {
  // TODO: Branding shouldn't be part of ui.styles. It should exist as ui.branding.
  const brandingColors = useEmbedBranding("branding");
  return brandingColors;
};

function getNamespace() {
  if (isValidNamespace(embedStore.namespace)) {
    // Persist this so that even if query params changed, we know that it is an embed.
    return embedStore.namespace;
  }
  if (isBrowser) {
    const url = new URL(document.URL);
    const namespace = url.searchParams.get("embed");
    embedStore.namespace = namespace;
    return namespace;
  }
}

const isEmbed = () => {
  const namespace = getNamespace();
  return isValidNamespace(namespace);
};

export const useIsEmbed = () => {
  // We can't simply return isEmbed() from this method.
  // isEmbed() returns different values on server and browser, which messes up the hydration.
  // TODO: We can avoid using document.URL and instead use Router.
  const [_isEmbed, setIsEmbed] = useState(false);
  useEffect(() => {
    setIsEmbed(isEmbed());
  }, []);
  return _isEmbed;
};

function unhideBody() {
  document.body.style.display = "block";
}

// If you add a method here, give type safety to parent manually by adding it to embed.ts. Look for "parentKnowsIframeReady" in it
export const methods = {
  ui: function style(uiConfig: UiConfig) {
    // TODO: Create automatic logger for all methods. Useful for debugging.
    log("Method: ui called", uiConfig);
    if (window.CalComPlan && window.CalComPlan !== "PRO") {
      log(`Upgrade to PRO for "ui" instruction to work`, window.CalComPlan);
      return;
    }
    const stylesConfig = uiConfig.styles;

    // In case where parent gives instructions before CalComPlan is set.
    // This is easily possible as React takes time to initialize and render components where this variable is set.
    if (!window.CalComPlan) {
      return requestAnimationFrame(() => {
        style(uiConfig);
      });
    }

    // body can't be styled using React state hook as it is generated by _document.tsx which doesn't support hooks.
    if (stylesConfig.body?.background) {
      document.body.style.background = stylesConfig.body.background as string;
    }

    setEmbedStyles(stylesConfig);
  },
  parentKnowsIframeReady: () => {
    log("Method: `parentKnowsIframeReady` called");
    runAsap(function tryInformingLinkReady() {
      // TODO: Do it by attaching a listener for change in parentInformedAboutContentHeight
      if (!embedStore.parentInformedAboutContentHeight) {
        runAsap(tryInformingLinkReady);
        return;
      }
      // No UI change should happen in sight. Let the parent height adjust and in next cycle show it.
      requestAnimationFrame(unhideBody);
      sdkActionManager?.fire("linkReady", {});
    });
  },
};

const messageParent = (data: any) => {
  parent.postMessage(
    {
      originator: "CAL",
      ...data,
    },
    "*"
  );
};

function keepParentInformedAboutDimensionChanges() {
  let knownIframeHeight: Number | null = null;
  let numDimensionChanges = 0;
  let isFirstTime = true;
  let isWindowLoadComplete = false;
  runAsap(function informAboutScroll() {
    if (document.readyState !== "complete") {
      // Wait for window to load to correctly calculate the initial scroll height.
      runAsap(informAboutScroll);
      return;
    }
    if (!isWindowLoadComplete) {
      // On Safari, even though document.readyState is complete, still the page is not rendered and we can't compute documentElement.scrollHeight correctly
      // Postponing to just next cycle allow us to fix this.
      setTimeout(() => {
        isWindowLoadComplete = true;
        informAboutScroll();
      }, 10);
      return;
    }
    if (!embedStore.windowLoadEventFired) {
      sdkActionManager?.fire("windowLoadComplete", {});
    }
    embedStore.windowLoadEventFired = true;

    const documentScrollHeight = document.documentElement.scrollHeight;
    const documentScrollWidth = document.documentElement.scrollWidth;
    const contentHeight = document.documentElement.offsetHeight;
    const contentWidth = document.documentElement.offsetWidth;

    // During first render let iframe tell parent that how much is the expected height to avoid scroll.
    // Parent would set the same value as the height of iframe which would prevent scroll.
    // On subsequent renders, consider html height as the height of the iframe. If we don't do this, then if iframe get's bigger in height, it would never shrink
    let iframeHeight = isFirstTime ? documentScrollHeight : contentHeight;
    let iframeWidth = isFirstTime ? documentScrollWidth : contentWidth;
    embedStore.parentInformedAboutContentHeight = true;
    // TODO: Handle width as well.
    if (knownIframeHeight !== iframeHeight) {
      knownIframeHeight = iframeHeight;
      numDimensionChanges++;
      // FIXME: This event shouldn't be subscribable by the user. Only by the SDK.
      sdkActionManager?.fire("dimension-changed", {
        iframeHeight,
        iframeWidth,
        isFirstTime,
      });
    }
    isFirstTime = false;
    // Parent Counterpart would change the dimension of iframe and thus page's dimension would be impacted which is recursive.
    // It should stop ideally by reaching a hiddenHeight value of 0.
    // FIXME: If 0 can't be reached we need to just abandon our quest for perfect iframe and let scroll be there. Such case can be logged in the wild and fixed later on.
    if (numDimensionChanges > 50) {
      console.warn("Too many dimension changes detected.");
      return;
    }
    runAsap(informAboutScroll);
  });
}

if (isBrowser) {
  const url = new URL(document.URL);
  if (url.searchParams.get("prerender") !== "true" && isEmbed()) {
    log("Initializing embed-iframe");
    // HACK
    const pageStatus = window.CalComPageStatus;
    // If embed link is opened in top, and not in iframe. Let the page be visible.
    if (top === window) {
      unhideBody();
    }

    sdkActionManager?.on("*", (e) => {
      const detail = e.detail;
      //console.log(detail.fullType, detail.type, detail.data);
      log(detail);
      messageParent(detail);
    });

    window.addEventListener("message", (e) => {
      const data: Record<string, any> = e.data;
      if (!data) {
        return;
      }
      const method: keyof typeof methods = data.method;
      if (data.originator === "CAL" && typeof method === "string") {
        methods[method]?.(data.arg);
      }
    });

    if (!pageStatus || pageStatus == "200") {
      keepParentInformedAboutDimensionChanges();
      sdkActionManager?.fire("iframeReady", {});
    } else
      sdkActionManager?.fire("linkFailed", {
        code: pageStatus,
        msg: "Problem loading the link",
        data: {
          url: document.URL,
        },
      });
  }
}
