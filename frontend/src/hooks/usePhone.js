import { useEffect, useState } from "react"

export function usePhone() {
  const query = "(max-width: 767px)"
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setPhone(media.matches)
    onChange()
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return phone
}
