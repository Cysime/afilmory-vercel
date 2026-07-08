import { clsxm } from "@afilmory/ui";
import { useAtom } from "jotai";
import * as React from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { gallerySettingAtom } from "~/atoms/app";
import { ThumbnailImage } from "~/components/ui/ThumbnailImage";
import { useMobile } from "~/hooks/useMobile";
import { usePanelDragDismiss } from "~/hooks/usePanelDragDismiss";
import {
  getViewerPhotos,
  getViewerSourceMode,
  useOpenPhotoViewer,
} from "~/hooks/usePhotoViewer";
import { buildGalleryFilterSearch } from "~/lib/gallery-filter-url";
import { translateDynamicKey } from "~/lib/i18n-dynamic";
import { buildPhotoDetailPathname } from "~/lib/photo-detail-route";
import { FilterPanel } from "~/modules/gallery/panels/FilterPanel";
import { useAfilmoryRuntime, usePhotoRepository } from "~/runtime/app-runtime";
import type { PhotoManifest } from "~/types/photo";

import {
  createGalleryGeoRegions,
  createGeoRegionLabelMaps,
} from "../filter-options";
import { resolveCommandKeyboardIntent } from "./keyboard";
import type { CommandAction } from "./model";
import {
  applyGalleryCommandAction,
  buildActiveFilterChips,
  buildCommandIndex,
  filterCommands,
  getActiveFilterCount,
  getAvailableFilterCount,
} from "./model";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const DISMISS_DRAG_THRESHOLD = 72;

// 焦点陷阱用的可聚焦元素选择器：保持零依赖的小实现，覆盖面板内会出现的控件。
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const CommandPalette = ({ isOpen, onClose }: CommandPaletteProps) => {
  const { t, i18n } = useTranslation();
  const commandT = useCallback(
    (key: string, options?: Record<string, unknown>) =>
      translateDynamicKey(i18n, key, options),
    [i18n],
  );
  const [gallerySetting, setGallerySetting] = useAtom(gallerySettingAtom);
  const navigate = useNavigate();
  const openViewer = useOpenPhotoViewer();
  const runtime = useAfilmoryRuntime();
  const photoRepository = usePhotoRepository();
  const allTags = useMemo(
    () => photoRepository.getAllTags(),
    [photoRepository],
  );
  const allCameras = useMemo(
    () => photoRepository.getAllCameras(),
    [photoRepository],
  );
  const allLenses = useMemo(
    () => photoRepository.getAllLenses(),
    [photoRepository],
  );
  const allPhotos = photoRepository.getPhotos();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isMobile = useMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // combobox/listbox 语义要求 aria-activedescendant 引用合法且页面唯一的 DOM id。
  // 命令 id 可能含空格（相机名、标签），encodeURIComponent 保证合法且不撞车。
  const baseDomId = useId();
  const listboxDomId = `${baseDomId}-listbox`;
  const getOptionDomId = useCallback(
    (commandId: string) =>
      `${baseDomId}-option-${encodeURIComponent(commandId)}`,
    [baseDomId],
  );

  // 下拉关闭手势（鼠标 / 触摸 / 触控笔统一 Pointer Events 一套）
  const {
    offset: panelDragOffset,
    isDragging: isDraggingPanel,
    handleRef: dragHandleRef,
  } = usePanelDragDismiss({
    enabled: isOpen,
    onDismiss: onClose,
    threshold: DISMISS_DRAG_THRESHOLD,
  });

  const activeFilterCount = getActiveFilterCount(gallerySetting);

  const hasFilters = activeFilterCount > 0;

  const handleReset = useCallback(() => {
    setQuery("");
    setSelectedIndex(0);
    setGallerySetting((prev) =>
      applyGalleryCommandAction(prev, { type: "clear-filters" }),
    );
  }, [setGallerySetting]);

  const geoRegions = useMemo(
    () => createGalleryGeoRegions(allPhotos),
    [allPhotos],
  );

  const regionLabelMaps = useMemo(
    () => createGeoRegionLabelMaps(geoRegions, i18n.language),
    [geoRegions, i18n.language],
  );

  const activeFilterChips = useMemo(
    () =>
      buildActiveFilterChips({
        gallerySetting,
        regionLabelMaps,
      }),
    [gallerySetting, regionLabelMaps],
  );

  // Reset state when opened (drag offset resets inside usePanelDragDismiss via `enabled`)
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      if (isMobile) return;
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isMobile, isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // a11y：对话框焦点管理。打开时记录先前焦点并把焦点移进面板 ——
  // 桌面端由上面的 effect 聚焦搜索框，移动端聚焦面板本身（tabIndex=-1，
  // 避免拉起虚拟键盘）；关闭 / 卸载时把焦点还原给打开前的元素。
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (isMobile) {
      panelRef.current?.focus({ preventScroll: true });
    }
    return () => {
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [isMobile, isOpen]);

  // 焦点陷阱：Tab / Shift+Tab 在面板内循环，不让焦点跑到被遮住的页面内容上。
  // 面板内点击非控件区域会把焦点落在面板本身（tabIndex=-1），keydown 仍会冒泡到这里。
  const handleFocusTrapKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = [
      ...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      e.preventDefault();
      return;
    }

    const active = document.activeElement;
    const activeInPanel =
      active instanceof HTMLElement && panel.contains(active);

    if (e.shiftKey) {
      if (!activeInPanel || active === first || active === panel) {
        e.preventDefault();
        last.focus();
      }
    } else if (!activeInPanel || active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const openPhoto = useCallback(
    (photo: PhotoManifest) => {
      const viewerPhotos = getViewerPhotos(runtime, photo.id);
      const photoIndex = viewerPhotos.findIndex((item) => item.id === photo.id);
      if (photoIndex === -1) {
        return;
      }

      openViewer(photoIndex, {
        sourceMode: getViewerSourceMode(runtime, photo.id),
        sourcePhotoIds: viewerPhotos.map((viewerPhoto) => viewerPhoto.id),
      });
      navigate({
        pathname: buildPhotoDetailPathname(photo.id),
        search: buildGalleryFilterSearch("", gallerySetting),
      });
      onClose();
    },
    [gallerySetting, navigate, onClose, openViewer, runtime],
  );

  const executeCommandAction = useCallback(
    (action: CommandAction) => {
      if (action.type === "open-photo") {
        const photo = allPhotos.find((item) => item.id === action.photoId);
        if (photo) {
          openPhoto(photo);
        }
        return;
      }

      setGallerySetting((prev) => applyGalleryCommandAction(prev, action));
    },
    [allPhotos, openPhoto, setGallerySetting],
  );

  const commands = useMemo(
    () =>
      buildCommandIndex({
        t: commandT,
        language: i18n.language,
        gallerySetting,
        allTags,
        allCameras,
        allLenses,
        allPhotos,
        geoRegions,
        query,
        hasFilters,
      }),
    [
      commandT,
      i18n.language,
      gallerySetting,
      allTags,
      allCameras,
      allLenses,
      allPhotos,
      geoRegions,
      query,
      hasFilters,
    ],
  );

  const filteredCommands = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const intent = resolveCommandKeyboardIntent(e.key, {
        selectedIndex,
        resultCount: filteredCommands.length,
      });

      if (intent.type === "none") {
        return;
      }

      e.preventDefault();
      if (intent.type === "move") {
        setSelectedIndex(intent.selectedIndex);
        return;
      }

      const command = filteredCommands[intent.selectedIndex];
      if (command) {
        executeCommandAction(command.action);
      }
    },
    [executeCommandAction, filteredCommands, selectedIndex],
  );

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = listRef.current?.children[selectedIndex];
    if (selectedElement instanceof HTMLElement) {
      selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  // Stable signature of the filtered result set (ids + order). Filtering often
  // changes the contents while keeping the same length, so resetting on length
  // alone leaves the highlight pointing at a different command than shown —
  // pressing Enter would then run the wrong command.
  const filteredCommandsKey = useMemo(
    () => filteredCommands.map((command) => command.id).join(" "),
    [filteredCommands],
  );

  // Reset selected index whenever the filtered command set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommandsKey]);

  if (!isOpen) return null;

  const isBrowsingFilters = !query.trim();
  const availableFilterCount = getAvailableFilterCount({
    allTags,
    allCameras,
    allLenses,
    geoRegions,
  });
  const resultSummary = query.trim()
    ? t("action.search.command-count", { count: filteredCommands.length })
    : t("action.search.showing-filters", { count: availableFilterCount });

  // 读屏器可见性：只有真正渲染选项列表时 combobox 才算 expanded，
  // aria-activedescendant 跟着高亮项走，箭头键选中什么用户就听到什么。
  const isListboxVisible = !isBrowsingFilters && filteredCommands.length > 0;
  const selectedCommand = filteredCommands[selectedIndex];
  const activeOptionDomId =
    isListboxVisible && selectedCommand
      ? getOptionDomId(selectedCommand.id)
      : undefined;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      onClick={onClose}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-xl transition-[background-color,backdrop-filter] duration-200" />

      {/* Command Palette Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("action.search.unified.title")}
        tabIndex={-1}
        onKeyDown={handleFocusTrapKeyDown}
        className="animate-in fade-in slide-in-from-bottom-4 bg-material-thick border-fill-tertiary relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[1.75rem] border-x border-t shadow-2xl backdrop-blur-2xl duration-200 outline-none lg:mb-6 lg:max-h-[min(86vh,46rem)] lg:rounded-[1.75rem] lg:border"
        style={{
          boxShadow:
            "0 8px 32px color-mix(in srgb, var(--color-accent) 8%, transparent), 0 4px 16px color-mix(in srgb, var(--color-accent) 6%, transparent), 0 2px 8px rgba(0, 0, 0, 0.1)",
          transform: `translateY(${panelDragOffset}px)`,
          transition: isDraggingPanel ? "none" : "transform 180ms ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner glow layer */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background:
              "linear-gradient(to bottom right, color-mix(in srgb, var(--color-accent) 5%, transparent), transparent, color-mix(in srgb, var(--color-accent) 5%, transparent))",
          }}
        />
        <div
          ref={dragHandleRef}
          className="flex h-11 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        >
          <div className="bg-fill-tertiary h-1.5 w-12 rounded-full" />
        </div>
        {/* Search Input */}
        <div className="border-fill-secondary relative border-b px-6 pb-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="bg-accent/10 border-accent/20 text-accent flex size-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm">
              <i className="i-mingcute-search-line text-accent text-lg" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-text text-lg leading-tight font-semibold text-pretty">
                {t("action.search.unified.title")}
              </h2>
              <p className="text-text-secondary mt-1 text-sm">
                {t("action.search.indexed-photos", { count: allPhotos.length })}
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="glassmorphic-btn border-fill-tertiary text-text-secondary hover:text-accent focus-visible:ring-accent/45 flex size-11 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,box-shadow,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-inset"
              aria-label={t("action.search.reset")}
              title={t("action.search.reset")}
            >
              <i className="i-mingcute-refresh-1-line text-base" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="glassmorphic-btn border-fill-tertiary text-text-secondary hover:text-accent focus-visible:ring-accent/45 flex size-11 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,box-shadow,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-inset"
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <i className="i-mingcute-close-line text-base" />
            </button>
          </div>

          <div className="bg-fill-vibrant-quinary border-fill-tertiary focus-within:border-accent/50 focus-within:bg-fill-secondary/70 focus-within:ring-accent/20 flex h-12 items-center gap-3 rounded-2xl border px-3 shadow-inner transition-[background-color,border-color,box-shadow] duration-200 focus-within:ring-2">
            <i className="i-mingcute-search-line text-text-tertiary shrink-0 text-lg" />
            <input
              ref={inputRef}
              type="text"
              name="gallery-search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("action.search.placeholder")}
              aria-label={t("action.search.placeholder")}
              role="combobox"
              aria-expanded={isListboxVisible}
              aria-controls={isListboxVisible ? listboxDomId : undefined}
              aria-activedescendant={activeOptionDomId}
              aria-autocomplete="list"
              className="text-text placeholder-text-tertiary h-full min-w-0 flex-1 bg-transparent text-base outline-none"
            />
          </div>
        </div>

        {hasFilters && (
          <div className="border-fill-secondary relative border-b px-6 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-text-secondary flex items-center gap-2 text-xs font-medium">
                <i className="i-mingcute-filter-3-line text-sm" />
                <span>
                  {t("action.search.active-filters", {
                    count: activeFilterCount,
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="text-text-secondary hover:text-accent focus-visible:ring-accent/35 min-h-11 rounded-full px-3 text-xs font-medium transition-colors focus-visible:ring-2"
              >
                {t("action.search.clear")}
              </button>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => executeCommandAction(chip.action)}
                  className="bg-accent/10 text-accent ring-accent/20 hover:bg-accent/15 focus-visible:ring-accent/45 flex min-h-11 max-w-[16rem] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 transition-colors ring-inset focus-visible:ring-2"
                  aria-label={`${t("action.search.clear")} ${chip.label}`}
                  title={chip.label}
                >
                  <i className={clsxm(chip.icon, "shrink-0 text-sm")} />
                  <span className="truncate">{chip.label}</span>
                  <i className="i-mingcute-close-line shrink-0 text-sm" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Commands List */}
        <div
          ref={listRef}
          id={isListboxVisible ? listboxDomId : undefined}
          role={isListboxVisible ? "listbox" : undefined}
          aria-label={
            isListboxVisible ? t("action.search.unified.title") : undefined
          }
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2"
        >
          {isBrowsingFilters ? (
            <FilterPanel
              showHeader={false}
              className="max-h-none overflow-visible px-6 pt-3 pb-8"
            />
          ) : filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <i className="i-mingcute-search-line text-text-quaternary mb-3 text-4xl" />
              <p className="text-text-secondary text-sm">
                {t("action.search.no-results")}
              </p>
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                type="button"
                id={getOptionDomId(cmd.id)}
                role="option"
                aria-selected={selectedIndex === index}
                onClick={() => executeCommandAction(cmd.action)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={clsxm(
                  "command-item focus-visible:ring-accent/35 group flex w-full items-center gap-3 px-6 py-3 text-left transition-[background-color,box-shadow,color] duration-200 focus-visible:ring-2 focus-visible:ring-inset",
                  selectedIndex === index && "selected",
                )}
              >
                {/* Icon */}
                <div
                  className={clsxm(
                    "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg transition-all duration-200",
                    cmd.active
                      ? "bg-accent/10 text-accent"
                      : "bg-fill-vibrant-quinary text-text-secondary",
                  )}
                  style={
                    cmd.active
                      ? {
                          boxShadow:
                            "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 20%, transparent)",
                        }
                      : undefined
                  }
                >
                  {cmd.thumbnail ? (
                    <ThumbnailImage
                      photoId={cmd.thumbnail.photoId}
                      src={cmd.thumbnail.src}
                      alt={cmd.thumbnail.alt}
                      thumbHash={cmd.thumbnail.thumbHash}
                      containerClassName="h-10 w-10 rounded-xl"
                      imageClassName="h-full w-full rounded-xl object-cover"
                      fetchPriority="low"
                    />
                  ) : (
                    <i className={cmd.icon} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="text-text min-w-0 truncate text-sm font-medium">
                      {cmd.title}
                    </span>
                    {cmd.badge !== undefined && (
                      <span className="bg-fill-tertiary text-text-secondary rounded-full px-2 py-0.5 text-xs">
                        {cmd.badge}
                      </span>
                    )}
                    {cmd.active && (
                      <span className="bg-accent flex h-5 w-5 items-center justify-center rounded-full text-white">
                        <i className="i-mingcute-check-line text-xs" />
                      </span>
                    )}
                  </div>
                  {cmd.subtitle && (
                    <p className="text-text-secondary truncate text-xs">
                      {cmd.subtitle}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-fill-secondary bg-fill-vibrant-quinary/40 relative border-t px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:pb-4">
          <div className="text-text-secondary flex items-center justify-between text-xs">
            <span aria-live="polite">{resultSummary}</span>
            {hasFilters && (
              <span>
                {t("action.search.active-count", { count: activeFilterCount })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
