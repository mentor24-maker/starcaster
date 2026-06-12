'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  renderBuilderEmailHtml,
  renderBuilderEmailHtmlWithFallback,
} = require('../../lib/builder/email-render');

const fixtureTemplate = {
  id: 1,
  name: 'Welcome Email',
  templateKind: 'email',
  emailFunction: 'signup_confirmation',
  pageBackground: { mode: 'color', color: '#eef6ff', color2: '#eaf4ff', imageUrl: '', styleKey: '' },
  layoutSections: [{
    id: 'section-1',
    title: '',
    layout: 'single',
    alignment: 'left',
    marginTop: '0',
    marginBottom: '0',
    mobileHidden: 'false',
    desktopHidden: 'false',
    mobileLayout: 'stack',
    background: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', imageUrl: '', styleKey: '' },
    cellBackgrounds: {},
    cellPadding: { main: '18' },
    cellVerticalMargin: {},
    cellMobileHidden: {},
    cellDesktopHidden: {},
    cellBorderWidth: {},
    cellBorderColor: {},
    cellBorderRadius: {},
    cellBorderStyle: {},
    cellShadow: {},
    cellOpacity: {},
    cellHAlign: {},
    cellVAlign: {},
    modules: [
      { id: 'm1', type: 'heading', column: 'main', name: 'Heading', text: 'Welcome aboard', settings: {} },
      { id: 'm2', type: 'text', column: 'main', name: 'Body', text: '<p>Confirm at {{ .ConfirmationURL }}</p>', settings: {} },
      { id: 'm3', type: 'button', column: 'main', name: 'CTA', text: 'Confirm', settings: { href: '{{ .ConfirmationURL }}' } },
    ],
  }],
  createdAt: '',
  updatedAt: '',
};

const mergeContext = {
  confirmationUrl: 'https://starcaster.pro/confirm?token=abc',
  email: 'fan@example.com',
  siteUrl: 'https://starcaster.pro',
};

test('renderBuilderEmailHtml renders sections and applies merge fields', () => {
  const html = renderBuilderEmailHtml(fixtureTemplate, mergeContext);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Welcome aboard'));
  assert.ok(html.includes('https://starcaster.pro/confirm?token=abc'));
  assert.ok(!html.includes('{{ .ConfirmationURL }}'));
});

test('renderBuilderEmailHtmlWithFallback falls back for empty templates', () => {
  const html = renderBuilderEmailHtmlWithFallback(null, mergeContext, 'signup_confirmation');
  assert.ok(html.length > 0);
  assert.ok(html.includes(mergeContext.confirmationUrl));
});
