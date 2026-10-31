import avatar from '../assets/dafeyu-avatar.png';

export function CompanionAvatar({ small = false }: { small?: boolean }) {
  return <img className={`companion-avatar ${small ? 'small' : ''}`} src={avatar} alt="大肥鱼" draggable={false} />;
}
