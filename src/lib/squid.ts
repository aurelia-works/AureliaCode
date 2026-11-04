/** The squid on a 22-unit grid: `body` is filled, `arms` stroked. */
export function squidPaths(sway: number): { body: string; arms: string } {
  const s = sway;
  return {
    body: "M11 1C14.6 4.4 16 7.6 16 10.6C16 12.6 14.7 13.6 11 13.6C7.3 13.6 6 12.6 6 10.6C6 7.6 7.4 4.4 11 1ZM5.8 8.2L2.8 10.8L6 11.2ZM16.2 8.2L19.2 10.8L16 11.2Z",
    arms: `M7.6 13.4C7.2 16 ${5.6 + s} 17 ${5 + s} 20M10 13.6C9.8 16.4 ${9.2 + s} 18 ${8.8 + s} 21M12 13.6C12.2 16.4 ${12.8 + s} 18 ${13.2 + s} 21M14.4 13.4C14.8 16 ${16.4 + s} 17 ${17 + s} 20`,
  };
}
