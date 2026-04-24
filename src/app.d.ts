declare global {
  namespace App {}

  interface Window {
    __themeIcon?: (theme: string) => string;
    __toggleTheme?: () => void;
    __mermaid?: {
      initialize: (options: { startOnLoad: boolean; theme: string }) => void;
    };
    __renderMermaid?: (container: Element | null) => void;
  }
}

export {};
