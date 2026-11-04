import { useState } from 'react'
import apkQr from '../../assets/apk-qr.svg'
import colabQr from '../../assets/colab-qr.svg'

/** The Colab notebook, shared from the Settings page. */
const COLAB_URL = 'https://colab.research.google.com/github/DSestu/sestudio/blob/main/colab/sestudio.ipynb'

/** The newest Android app: GitHub redirects this to the latest release's APK. */
const APK_URL = 'https://github.com/DSestu/sestudio/releases/latest/download/sestudio.apk'

/**
 * Settings › Share sestudio: links and QR codes for someone else to get their
 * own sestudio, the Android app or the Colab notebook. Static images: both
 * links never change.
 */
export default function Share() {
  return (
    <>
      <p className="text-sm text-base-content/60 -mt-2">For someone else to get their own sestudio.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ShareLink
          title="Android app"
          text="Scan on an Android phone to install the latest version. It runs on the phone itself."
          url={APK_URL}
          qr={apkQr}
        />
        <ShareLink
          title="Google Colab"
          text="Their own copy, on their own Google account, with a GPU. Needs a paid Colab plan."
          url={COLAB_URL}
          qr={colabQr}
        />
      </div>
    </>
  )
}

function ShareLink({ title, text, url, qr }: { title: string; text: string; url: string; qr: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-[14px] bg-base-200 p-4">
      <div>
        <h3 className="text-[15px] font-medium">{title}</h3>
        <p className="text-xs leading-snug text-base-content/50 mt-0.5">{text}</p>
      </div>
      <img src={qr} alt={`QR code: ${title}`} className="size-40 rounded-lg bg-white p-2" />
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="link link-hover link-primary text-xs truncate"
        title={url}
      >
        {url.replace(/^https:\/\//, '')}
      </a>
      <div className="flex gap-2">
        {/* Both need a secure context: absent on a plain-HTTP LAN address. */}
        {'share' in navigator && (
          <button
            className="btn btn-sm btn-primary"
            onClick={() => navigator.share({ title: `sestudio: ${title}`, url }).catch(() => {})}
          >
            Share…
          </button>
        )}
        {navigator.clipboard && (
          <button className="btn btn-sm btn-ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        )}
      </div>
    </section>
  )
}
