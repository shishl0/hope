import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = sessionStorage.getItem('hope_access') || localStorage.getItem('hope_access');

  if (!token || !req.url.startsWith('http://127.0.0.1:8000/api')) {
    return next(req);
  }

  return next(req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`,
    },
  }));
};
