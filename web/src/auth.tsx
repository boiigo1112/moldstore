import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiMe, type AuthUser } from './api'
import { wfClearToken, wfMe } from './wf'

interface AuthCtx {
  user: AuthUser | null
  ready: boolean
  signin: (token: string, user: AuthUser) => void
  signout: () => void
}

const Ctx = createContext<AuthCtx>({ user: null, ready: false, signin: () => {}, signout: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('moldstore_token')) {
      setReady(true)
      return
    }
    apiMe()
      // DEV fallback: ถ้า Go API ไม่รัน ให้ตรวจ token ผ่าน workflow sidecar แทน
      .catch(() =>
        wfMe().then((d) => ({
          ...d.user,
          display_name: (d.user as AuthUser).display_name ?? d.user.username,
        })),
      )
      .then(setUser)
      .catch(() => localStorage.removeItem('moldstore_token'))
      .finally(() => setReady(true))
  }, [])

  const signin = (token: string, u: AuthUser) => {
    localStorage.setItem('moldstore_token', token)
    setUser(u)
  }
  const signout = () => {
    localStorage.removeItem('moldstore_token')
    wfClearToken()
    setUser(null)
  }
  return <Ctx.Provider value={{ user, ready, signin, signout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
