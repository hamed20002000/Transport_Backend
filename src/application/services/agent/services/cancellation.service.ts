import { Injectable } from '@nestjs/common';

/**
 * برای هر کاربر یک AbortController نگه می‌داره تا بشه اجرای در حال انجامش
 * رو از بیرون (مثلاً وقتی کاربر دکمه‌ی "توقف" رو می‌زنه) لغو کرد.
 */
@Injectable()
export class CancellationService {
    private controllers = new Map<string, AbortController>();

    /**
     * شروع یک اجرای جدید و قابل‌لغو. اگه از قبل یک اجرای دیگه برای همین
     * کاربر در حال اجرا بود، اول اونو لغو می‌کنیم (چون منطقاً کاربر
     * نمی‌تونه هم‌زمان دو تا دستور مستقل در حال اجرا داشته باشه).
     */
    start(userId: string): AbortController {
        this.cancel(userId);
        const controller = new AbortController();
        this.controllers.set(userId, controller);
        return controller;
    }

    /**
     * لغو اجرای فعلی کاربر (اگه وجود داشته باشه). این متد از بیرون
     * (مثلاً یک socket event از سمت کلاینت) صدا زده می‌شه.
     */
    cancel(userId: string): boolean {
        const controller = this.controllers.get(userId);
        if (controller) {
            controller.abort();
            this.controllers.delete(userId);
            return true;
        }
        return false;
    }

    /**
     * وقتی اجرا (چه موفق چه ناموفق چه لغوشده) تموم شد، باید صدا زده بشه
     * تا از memory leak جلوگیری بشه.
     */
    finish(userId: string): void {
        this.controllers.delete(userId);
    }
}