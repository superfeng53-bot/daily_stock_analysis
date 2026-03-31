import type React from 'react';
import { useRef, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { systemConfigApi, SystemConfigConflictError } from '../../api/systemConfig';
import type { ParsedApiError } from '../../api/error';
import { getParsedApiError } from '../../api/error';
import type { HistoryItem } from '../../types/analysis';
import { Badge, Button, InlineAlert, ScrollArea } from '../common';
import { DashboardPanelHeader, DashboardStateBlock } from '../dashboard';
import { HistoryListItem } from './HistoryListItem';

interface HistoryListProps {
  items: HistoryItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  selectedId?: number;  // 当前选中的历史记录 ID
  selectedIds: Set<number>;
  isDeleting?: boolean;
  onItemClick: (recordId: number) => void;  // 点击记录的回调
  onLoadMore: () => void;
  onToggleItemSelection: (recordId: number) => void;
  onToggleSelectAll: () => void;
  onDeleteSelected: () => void;
  className?: string;
}

/**
 * 历史记录列表组件 (升级版)
 * 使用新设计系统组件实现，支持批量选择和滚动加载
 */
export const HistoryList: React.FC<HistoryListProps> = ({
  items,
  isLoading,
  isLoadingMore,
  hasMore,
  selectedId,
  selectedIds,
  isDeleting = false,
  onItemClick,
  onLoadMore,
  onToggleItemSelection,
  onToggleSelectAll,
  onDeleteSelected,
  className = '',
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectAllId = useId();

  const selectedCount = items.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = items.length > 0 && selectedCount === items.length;
  const someVisibleSelected = selectedCount > 0 && !allVisibleSelected;
  const [updatingStockCode, setUpdatingStockCode] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<ParsedApiError | null>(null);
  const [stockListValue, setStockListValue] = useState('');
  const [configVersion, setConfigVersion] = useState('');
  const [maskToken, setMaskToken] = useState('******');

  const extractStockListValue = useCallback((configItems: Array<{ key: string; value: string }>) => {
    const stockListItem = configItems.find((item) => item.key === 'STOCK_LIST');
    return (stockListItem?.value || '').trim();
  }, []);

  const loadStockConfig = useCallback(async () => {
    const config = await systemConfigApi.getConfig(true);
    setConfigVersion(config.configVersion);
    setMaskToken(config.maskToken || '******');
    setStockListValue(extractStockListValue(config.items));
    return config;
  }, [extractStockListValue]);

  const normalizedStockList = useMemo(
    () => stockListValue
      .split(',')
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean),
    [stockListValue],
  );

  const stockListSet = useMemo(
    () => new Set(normalizedStockList),
    [normalizedStockList],
  );

  const normalizeStockCode = useCallback((stockCode: string) => stockCode.trim().toUpperCase(), []);

  const updateStockList = useCallback(async (nextList: string[]) => {
    let currentConfigVersion = configVersion;
    let currentMaskToken = maskToken;

    if (!currentConfigVersion) {
      const loadedConfig = await loadStockConfig();
      currentConfigVersion = loadedConfig.configVersion;
      currentMaskToken = loadedConfig.maskToken || '******';
    }

    const nextValue = nextList.join(',');
    const updateResult = await systemConfigApi.update({
      configVersion: currentConfigVersion,
      maskToken: currentMaskToken,
      reloadNow: true,
      items: [{ key: 'STOCK_LIST', value: nextValue }],
    });

    setStockListValue(nextValue);
    setConfigVersion(updateResult.configVersion);
  }, [configVersion, loadStockConfig, maskToken]);

  const toggleFavoriteStock = useCallback(async (stockCode: string) => {
    if (updatingStockCode) {
      return;
    }

    const normalizedCode = normalizeStockCode(stockCode);
    const isFavorite = stockListSet.has(normalizedCode);
    const nextList = isFavorite
      ? normalizedStockList.filter((code) => code !== normalizedCode)
      : [...normalizedStockList, normalizedCode];

    setUpdatingStockCode(normalizedCode);
    setMergeError(null);

    try {
      await updateStockList(nextList);
    } catch (error: unknown) {
      if (error instanceof SystemConfigConflictError) {
        await loadStockConfig();
        const conflictError = getParsedApiError(error);
        setMergeError({
          ...conflictError,
          message: '配置已更新，请再次点击对应按钮。',
        });
      } else {
        setMergeError(getParsedApiError(error));
      }
    } finally {
      setUpdatingStockCode(null);
    }
  }, [loadStockConfig, normalizeStockCode, normalizedStockList, stockListSet, updateStockList, updatingStockCode]);

  // 使用 IntersectionObserver 检测滚动到底部
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const target = entries[0];
      if (target.isIntersecting && hasMore && !isLoading && !isLoadingMore) {
        const container = scrollContainerRef.current;
        if (container && container.scrollHeight > container.clientHeight) {
          onLoadMore();
        }
      }
    },
    [hasMore, isLoading, isLoadingMore, onLoadMore]
  );

  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    const container = scrollContainerRef.current;
    if (!trigger || !container) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: container,
      rootMargin: '20px',
      threshold: 0.1,
    });

    observer.observe(trigger);
    return () => observer.disconnect();
  }, [handleObserver]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    void loadStockConfig().catch(() => {
      // ignore initial load failure; user can still browse history
    });
  }, [loadStockConfig]);

  return (
    <aside className={`glass-card overflow-hidden flex flex-col ${className}`}>
      <ScrollArea
        viewportRef={scrollContainerRef}
        viewportClassName="p-4"
        testId="home-history-list-scroll"
      >
        <div className="mb-4 space-y-3">
          <DashboardPanelHeader
            className="mb-1"
            title="历史分析"
            titleClassName="text-sm font-medium"
            leading={(
              <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            headingClassName="items-center"
            actions={
              selectedCount > 0 ? (
                <Badge variant="info" size="sm" className="history-selection-badge animate-in fade-in zoom-in duration-200">
                  已选 {selectedCount}
                </Badge>
              ) : undefined
            }
          />

          {items.length > 0 && (
            <div className="flex items-center gap-2">
              <label
                className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1"
                htmlFor={selectAllId}
              >
                <input
                  id={selectAllId}
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={onToggleSelectAll}
                  disabled={isDeleting}
                  aria-label="全选当前已加载历史记录"
                  className="history-select-all-checkbox h-3.5 w-3.5 cursor-pointer bg-transparent accent-primary focus:ring-primary/30 disabled:opacity-50"
                />
                <span className="text-[11px] text-muted-text select-none">全选当前</span>
              </label>
              <Button
                variant="danger-subtle"
                size="xsm"
                onClick={onDeleteSelected}
                disabled={selectedCount === 0 || isDeleting}
                isLoading={isDeleting}
                className="history-batch-delete-button disabled:!border-transparent disabled:!bg-transparent"
              >
                {isDeleting ? '删除中' : '删除'}
              </Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <DashboardStateBlock
            loading
            compact
            title="加载历史记录中..."
          />
        ) : items.length === 0 ? (
          <DashboardStateBlock
            title="暂无历史分析记录"
            description="完成首次分析后，这里会保留最近结果。"
            icon={(
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          />
        ) : (
          <div className="space-y-2">
            {mergeError ? (
              <InlineAlert
                variant="danger"
                message={mergeError.message}
                className="rounded-xl px-3 py-2 text-xs shadow-none"
              />
            ) : null}

            {items.map((item) => (
              <HistoryListItem
                key={item.id}
                item={item}
                isViewing={selectedId === item.id}
                isChecked={selectedIds.has(item.id)}
                isDeleting={isDeleting}
                isFavorite={stockListSet.has(normalizeStockCode(item.stockCode))}
                isFavoriteUpdating={updatingStockCode === normalizeStockCode(item.stockCode)}
                onToggleChecked={onToggleItemSelection}
                onClick={onItemClick}
                onToggleFavorite={(stockCode) => {
                  void toggleFavoriteStock(stockCode);
                }}
              />
            ))}

            <div ref={loadMoreTriggerRef} className="h-4" />
            
            {isLoadingMore && (
              <div className="flex justify-center py-4">
                <div className="home-spinner h-5 w-5 animate-spin border-2" />
              </div>
            )}

            {!hasMore && items.length > 0 && (
              <div className="text-center py-5">
                <div className="h-px bg-subtle w-full mb-3" />
                <span className="text-[10px] text-secondary-text uppercase tracking-[0.2em]">已到底部</span>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
};
