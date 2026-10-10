import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import { formatPhoneInput } from '@pdr/shared';

export type PhoneInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  value: string;
  /** Отформатированное значение: «+7 927 266-60-33». На сервер уходит как есть — нормализует он. */
  onChange: (value: string) => void;
};

/**
 * Единое поле телефона для всех форм: новый клиент, обращение, профиль,
 * приглашение. «+7» подставляется само, 8 в начале становится +7, вставленный
 * номер приводится к виду «+7 927 266-60-33». Курсор остаётся там, где
 * мастер правит, а стирание дефиса или пробела стирает цифру перед ним —
 * иначе форматирование возвращало бы разделитель и курсор «застревал».
 */
export function PhoneInput({ value, onChange, className, ...rest }: PhoneInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaret.current !== null && document.activeElement === el) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  });

  return (
    <input
      {...rest}
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete={rest.autoComplete ?? 'tel'}
      className={clsx('pdr-input', className)}
      value={value}
      onChange={(e) => {
        let raw = e.target.value;
        let caret = e.target.selectionStart ?? raw.length;
        const inputType = (e.nativeEvent as InputEvent).inputType;

        // Стёрли только разделитель — стираем и цифру перед ним.
        if (
          inputType === 'deleteContentBackward' &&
          raw.length < value.length &&
          raw.replace(/\D/g, '') === value.replace(/\D/g, '')
        ) {
          let i = caret - 1;
          while (i >= 0 && !/\d/.test(raw[i]!)) i -= 1;
          if (i >= 0) {
            raw = raw.slice(0, i) + raw.slice(i + 1);
            caret = i;
          }
        }

        const next = formatPhoneInput(raw, caret);
        pendingCaret.current = next.caret;
        onChange(next.value);
      }}
    />
  );
}
