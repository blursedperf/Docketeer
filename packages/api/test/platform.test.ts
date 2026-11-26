import { describe, expect, it } from 'vitest';
import { applyHostPlatform, layoutMode, Platform } from '../src/util';

const fresh = () => ({ ...Platform, isMacOS: false, isWin: false, isLinux: true });

describe('Platform from the host', () => {
	it('desktop keeps the desktop flags', () => {
		const p = fresh();
		applyHostPlatform({ platform: 'linux' }, p);
		expect(p).toMatchObject({ isDesktop: true, isDesktopApp: true, isMobile: false, isMobileApp: false, isIosApp: false, isPhone: false, isTablet: false, isLinux: true });
	});
	it('an iPad is a tablet, an iOS app, and macOS for its keys', () => {
		const p = fresh();
		applyHostPlatform({ platform: 'ios', formFactor: 'tablet' }, p);
		expect(p).toMatchObject({ isDesktop: false, isDesktopApp: false, isMobile: true, isMobileApp: true, isIosApp: true, isTablet: true, isPhone: false, isMacOS: true, isLinux: false, isWin: false, isSafari: true });
	});
	it('an iPhone is a phone', () => {
		const p = fresh();
		applyHostPlatform({ platform: 'ios', formFactor: 'phone' }, p);
		expect(p).toMatchObject({ isMobile: true, isPhone: true, isTablet: false, isIosApp: true, isMacOS: true });
	});
});

describe('layout mode', () => {
	it('is compact below 700 CSS pixels, whatever the device', () => {
		expect(layoutMode(393)).toBe('compact'); // iPhone
		expect(layoutMode(320)).toBe('compact'); // iPad in Slide Over
		expect(layoutMode(699)).toBe('compact');
		expect(layoutMode(700)).toBe('regular');
		expect(layoutMode(1194)).toBe('regular'); // iPad landscape
	});
});
