import React, { useState, useRef, useEffect } from 'react';
import { Search, Globe, LogOut, User } from 'lucide-react';
import { useI18n } from '../i18n';

interface HeaderProps {
  user?: { username: string; displayName?: string } | null;
  onLogout?: () => void;
}

export function Header({ user, onLogout }: HeaderProps) {
  const { locale, setLocale, t } = useI18n();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="bg-surface/90 backdrop-blur-md border-b border-outline-variant flex justify-between items-center w-full px-6 py-3 sticky top-0 z-50">
      <div className="flex items-center gap-4">
        <span className="text-xl font-headline font-semibold tracking-tight text-primary">BlindVault</span>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-4 h-4" />
          <input 
            type="text" 
            placeholder={t('header.searchPlaceholder')} 
            className="input-sahara pl-9 pr-4 py-1.5 rounded-full text-sm text-on-surface placeholder:text-on-surface-variant w-64 bg-surface-container-lowest" 
          />
        </div>
        
        <div className="flex items-center gap-2">
          {/* Language toggle */}
          <button
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-on-surface-variant hover:bg-surface-container hover:text-primary transition-all duration-300 active:scale-95 border border-outline-variant/50"
            title={locale === 'zh' ? 'Switch to English' : 'Switch to Chinese'}
          >
            <Globe className="w-3.5 h-3.5" />
            {locale === 'zh' ? 'EN' : '中文'}
          </button>

          {/* User avatar & menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="h-9 w-9 rounded-full bg-primary/10 border border-outline-variant overflow-hidden flex items-center justify-center cursor-pointer hover:border-primary transition-colors"
              title={user?.displayName || user?.username || 'User'}
            >
              {user ? (
                <span className="text-sm font-bold text-primary uppercase">
                  {(user.displayName || user.username).charAt(0)}
                </span>
              ) : (
                <User className="w-4 h-4 text-on-surface-variant" />
              )}
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-12 w-56 bg-surface border border-outline-variant rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                {user && (
                  <div className="px-4 py-3 border-b border-outline-variant bg-surface-container-lowest">
                    <p className="text-sm font-semibold text-on-surface truncate">{user.displayName || user.username}</p>
                    <p className="text-xs text-on-surface-variant truncate">@{user.username}</p>
                  </div>
                )}
                {onLogout && (
                  <button
                    onClick={() => { setShowUserMenu(false); onLogout(); }}
                    className="w-full px-4 py-3 text-sm text-left text-on-surface-variant hover:bg-surface-container hover:text-error flex items-center gap-2.5 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('header.logout')}
                  </button>
                )}
                {!user && !onLogout && (
                  <div className="px-4 py-3 text-xs text-on-surface-variant">
                    {t('header.notLoggedIn')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
