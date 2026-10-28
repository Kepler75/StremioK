/* Views: the screens (Home, title pages, Search, Settings). Global namespace: Views
   The code lives in js/view-core.js, view-home.js, view-detail.js, view-search.js,
   view-settings.js and view-discover.js (loaded before this file); this file just
   assembles the public API. */
var Views = (function (V) {
    'use strict';
    return {
        renderHome: V.renderHome, renderDetail: V.renderDetail, applyAppearance: V.applyAppearance,
        renderPerson: V.renderPerson, detailSnapshot: V.detailSnapshot, restoreDetail: V.restoreDetail, lightSnapshot: V.lightSnapshot, renderSettings: V.renderSettings,
        settingsRoot: V.settingsRoot, backInSettings: V.backInSettings, guideBackOn: V.guideBackOn,
        // a screen left: its downloads still running (a title page's details, Discover's
        // pages, a search's rows) stopped
        leaveScreen: function (name) { var f = { detail: V.leaveDetail, discover: V.leaveDiscover, search: V.leaveSearch }[name]; if (f) { f(); } }, backInLocal: V.backInLocal, setHomeTab: V.setHomeTab,
        renderLive: V.renderLive,
        renderSearch: V.renderSearch, searchFor: function (q) { V.searchFor(q); }, renderDiscover: V.renderDiscover, renderEntry: V.renderEntry, backInDetail: V.backInDetail,
        homeDirty: V.homeDirty, refreshHomeIfStale: V.refreshHomeIfStale, alertNewEpisodes: V.alertNewEpisodes, previewTiles: V.previewTiles, withShowInfo: V.withShowInfo,
        isModalOpen: V.isModalOpen, closeModal: V.closeModal, confirm: V.confirm, moveKey: V.moveKey, availableTabs: V.availableTabs,
        menuItems: V.menuItems, menuOrder: V.menuOrder, moveMenuItem: V.moveMenuItem
    };
})(ViewParts);
