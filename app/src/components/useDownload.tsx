import { useEffect, useRef, useState } from 'react';
export function useDownload() {
  const [file, setFile] = useState<{ url: string; name: string } | null>(null),
    anchor = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!file) return;
    anchor.current?.click();
    const timer = setTimeout(() => URL.revokeObjectURL(file.url), 10000);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(file.url);
    };
  }, [file]);
  return {
    download: (blob: Blob, name: string) =>
      setFile({ url: URL.createObjectURL(blob), name }),
    downloadLink: (
      <a ref={anchor} hidden href={file?.url} download={file?.name} />
    ),
  };
}
