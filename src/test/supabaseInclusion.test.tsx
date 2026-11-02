import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AddProfileDialog } from '../components/AddProfileDialog'

const request = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ IS_STATIC: true, HAS_SUPABASE: true, request }))

it('adds a public profile automatically and refreshes the community after confirmed approval', async () => {
  request.mockResolvedValue({ status: 'approved', message: 'Profile added to the community.' })
  const onAdded = vi.fn()
  const user = userEvent.setup()
  render(<AddProfileDialog close={vi.fn()} onAdded={onAdded} />)
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Kaggle username'), 'loplop05')
  await user.selectOptions(within(dialog).getByLabelText('City in Jordan'), 'Not specified')
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(within(dialog).getByRole('button', { name: 'Add profile' }))
  expect(request).toHaveBeenCalledWith('/nominations', expect.objectContaining({ method: 'POST', body: JSON.stringify({ username: 'loplop05', city: 'Not specified', evidence_url: 'https://www.kaggle.com/loplop05', confirmed: true }) }))
  expect(await within(dialog).findByText('Profile added.')).toBeInTheDocument()
  expect(onAdded).toHaveBeenCalledOnce()
  expect(within(dialog).queryByText('You’re on the list.')).not.toBeInTheDocument()
})

it('preserves submitted fields when the community service is unavailable', async () => {
  request.mockRejectedValue(new Error('The community service is unavailable.'))
  const user = userEvent.setup()
  render(<AddProfileDialog close={vi.fn()} />)
  await user.type(screen.getByLabelText('Kaggle username'), 'loplop05')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Add profile' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  expect(screen.getByLabelText('Kaggle username')).toHaveValue('loplop05')
  expect(screen.getByRole('button', { name: 'Add profile' })).toBeEnabled()
})

it('distinguishes an automatic retry from an accepted profile', async () => {
  request.mockResolvedValue({ status: 'checking', message: 'We will retry automatically.' })
  const onAdded = vi.fn(), user = userEvent.setup()
  render(<AddProfileDialog close={vi.fn()} onAdded={onAdded} />)
  await user.type(screen.getByLabelText('Kaggle username'), 'loplop05')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Add profile' }))
  expect(await screen.findByText('Automatic check queued.')).toBeInTheDocument()
  expect(onAdded).not.toHaveBeenCalled()
})
