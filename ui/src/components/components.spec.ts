import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import AsyncPanel from './AsyncPanel.vue';
import BaseButton from './BaseButton.vue';
import BaseInput from './BaseInput.vue';
import BaseSelect from './BaseSelect.vue';
import CopyableValue from './CopyableValue.vue';

/**
 * These cover the behaviour, not the appearance: what a component emits, what it
 * refuses to emit, and the attributes that decide whether a screen reader can
 * follow it. Colours and spacing are not tested — a snapshot of them would fail on
 * every deliberate change and pass on every broken one.
 */
describe('@components', () => {
  describe('BaseButton', () => {
    describe('when it is clicked normally', () => {
      it('should emit the click', async () => {
        const button = mount(BaseButton, { slots: { default: 'Save' } });

        await button.trigger('click');

        expect(button.emitted('click')).toHaveLength(1);
      });
    });

    describe('when it is loading', () => {
      it('should emit nothing, however many times it is clicked', async () => {
        // The whole reason the state exists: a slow request invites a second click,
        // and a second click is a second tenant, a second message, a second token.
        const button = mount(BaseButton, {
          props: { loading: true },
          slots: { default: 'Save' },
        });

        await button.trigger('click');
        await button.trigger('click');

        expect(button.emitted('click')).toBeUndefined();
      });

      it('should say so rather than only looking busy', async () => {
        const button = mount(BaseButton, { props: { loading: true } });

        expect(button.attributes('aria-busy')).toBe('true');
        expect(button.attributes('disabled')).toBeDefined();
      });

      it('should keep the label in the DOM so the width does not change', () => {
        const button = mount(BaseButton, {
          props: { loading: true },
          slots: { default: 'Create tenant' },
        });

        expect(button.text()).toContain('Create tenant');
      });
    });

    describe('when it is disabled', () => {
      it('should emit nothing', async () => {
        const button = mount(BaseButton, { props: { disabled: true } });

        await button.trigger('click');

        expect(button.emitted('click')).toBeUndefined();
      });
    });

    describe('when no type is given', () => {
      it('should be a button, not a submit', () => {
        // HTML defaults a button inside a form to submit. Every one of these placed
        // in a form would post it.
        expect(mount(BaseButton).attributes('type')).toBe('button');
      });
    });
  });

  describe('BaseInput', () => {
    describe('when the value changes', () => {
      it('should emit the new value instead of mutating the prop', async () => {
        const input = mount(BaseInput, {
          props: { modelValue: '', label: 'Tenant name' },
        });

        await input.find('input').setValue('Acme');

        expect(input.emitted('update:modelValue')).toEqual([['Acme']]);
      });
    });

    describe('when it has a label', () => {
      it('should tie the label to the control', () => {
        const input = mount(BaseInput, {
          props: { modelValue: '', label: 'Tenant name' },
        });

        expect(input.find('label').attributes('for')).toBe(
          input.find('input').attributes('id'),
        );
      });
    });

    describe('when it has both a hint and an error', () => {
      it('should point the control at both, not one', async () => {
        // The failing half is the one that gets dropped, and losing the hint leaves
        // a reader who cannot see the field with no idea what it wanted.
        const input = mount(BaseInput, {
          props: {
            modelValue: '',
            label: 'Tenant name',
            hint: 'Shown in the picker',
            error: 'Required',
          },
        });

        const describedBy = input.find('input').attributes('aria-describedby')?.split(' ');
        const hintId = input.find('.hint').attributes('id');
        const errorId = input.find('.error').attributes('id');

        expect(describedBy).toEqual([hintId, errorId]);
      });

      it('should mark the control invalid and announce the message', () => {
        const input = mount(BaseInput, {
          props: { modelValue: '', label: 'Tenant name', error: 'Required' },
        });

        expect(input.find('input').attributes('aria-invalid')).toBe('true');
        expect(input.find('[role="alert"]').text()).toBe('Required');
      });
    });

    describe('when it is valid', () => {
      it('should carry no describedby at all', () => {
        // An empty attribute points at an element that does not exist, which some
        // screen readers read as an empty description rather than as none.
        const input = mount(BaseInput, {
          props: { modelValue: '', label: 'Tenant name' },
        });

        expect(input.find('input').attributes('aria-describedby')).toBeUndefined();
      });
    });
  });

  describe('BaseSelect', () => {
    describe('when an option is chosen', () => {
      it('should emit its value', async () => {
        const select = mount(BaseSelect, {
          props: {
            modelValue: '',
            label: 'Tenant',
            options: [
              { value: 't1', label: 'Acme' },
              { value: 't2', label: 'Globex' },
            ],
          },
        });

        await select.find('select').setValue('t2');

        expect(select.emitted('update:modelValue')).toEqual([['t2']]);
      });
    });

    describe('when an option has a detail', () => {
      it('should show it beside the label', () => {
        const select = mount(BaseSelect, {
          props: {
            modelValue: '',
            label: 'User',
            options: [{ value: 'u1', label: 'Alice', detail: 'alice@acme.test' }],
          },
        });

        expect(select.find('option').text()).toBe('Alice — alice@acme.test');
      });
    });
  });

  describe('AsyncPanel', () => {
    describe('when it is pending', () => {
      it('should say it is busy and show nothing else', () => {
        const panel = mount(AsyncPanel, {
          props: { pending: true },
          slots: { default: '<p>content</p>' },
        });

        expect(panel.attributes('aria-busy')).toBe('true');
        expect(panel.text()).toContain('Loading…');
        expect(panel.text()).not.toContain('content');
      });
    });

    describe('when it has failed', () => {
      it('should announce the message rather than showing it silently', () => {
        const panel = mount(AsyncPanel, {
          props: { pending: false, error: 'Elasticsearch is down' },
        });

        expect(panel.find('[role="alert"]').text()).toContain('Elasticsearch is down');
      });

      it('should offer a retry only when someone is listening for it', async () => {
        const withoutRetry = mount(AsyncPanel, {
          props: { pending: false, error: 'boom' },
        });
        expect(withoutRetry.text()).not.toContain('Try again');

        const onRetry = vi.fn();
        const withRetry = mount(AsyncPanel, {
          props: { pending: false, error: 'boom', onRetry },
        });
        await withRetry.find('button').trigger('click');

        expect(onRetry).toHaveBeenCalledTimes(1);
      });
    });

    describe('when it is empty', () => {
      it('should say what is missing instead of rendering nothing', () => {
        const panel = mount(AsyncPanel, {
          props: {
            pending: false,
            empty: true,
            emptyMessage: 'No tenants yet.',
            emptyHint: 'Create one to get started.',
          },
          slots: { default: '<p>content</p>' },
        });

        expect(panel.text()).toContain('No tenants yet.');
        expect(panel.text()).toContain('Create one to get started.');
        expect(panel.text()).not.toContain('content');
      });
    });

    describe('when it is ready', () => {
      it('should render the content and drop the busy flag', () => {
        const panel = mount(AsyncPanel, {
          props: { pending: false },
          slots: { default: '<p>content</p>' },
        });

        expect(panel.text()).toContain('content');
        expect(panel.attributes('aria-busy')).toBeUndefined();
      });
    });
  });

  describe('CopyableValue', () => {
    const withClipboard = (writeText: () => Promise<void>) => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    };

    describe('when it is copied', () => {
      it('should put the whole value on the clipboard, not the shortened one', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        withClipboard(writeText);
        const value = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.a-very-long-token';

        const copyable = mount(CopyableValue, { props: { value } });
        await copyable.findAll('button')[0]?.trigger('click');
        await copyable.vm.$nextTick();

        expect(writeText).toHaveBeenCalledWith(value);
        expect(copyable.find('[role="status"]').text()).toBe('Copied');
      });
    });

    describe('when the clipboard is unavailable', () => {
      it('should tell the reader instead of throwing', async () => {
        // navigator.clipboard is absent over plain http on a LAN address, which is
        // exactly how someone else on the team opens this.
        Object.defineProperty(navigator, 'clipboard', {
          value: undefined,
          configurable: true,
        });

        const copyable = mount(CopyableValue, { props: { value: 'token' } });
        await copyable.findAll('button')[0]?.trigger('click');
        await copyable.vm.$nextTick();

        expect(copyable.find('[role="status"]').text()).toContain('Copy failed');
      });
    });

    describe('when the value is a secret', () => {
      it('should mask it until it is asked for', async () => {
        const copyable = mount(CopyableValue, {
          props: { value: 'super-secret-token', secret: true },
        });

        expect(copyable.find('code').text()).not.toContain('super-secret-token');

        await copyable.findAll('button')[0]?.trigger('click');

        expect(copyable.find('code').text()).toBe('super-secret-token');
      });
    });
  });
});
