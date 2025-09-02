'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Bot, User, ChevronUp, ChevronDown, MessageCircle } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: Date;
}

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleSendMessage = () => {
    if (!input.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    setInput('');

    // Simulate AI response (placeholder)
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: "I'm an AI agent placeholder. I'm ready to help you with your development tasks!",
        sender: 'agent',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiResponse]);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Collapsed state - floating button
  if (isCollapsed) {
    return (
      <div className="flex justify-center">
        <div className="bg-gray-600 hover:bg-gray-700 text-white rounded-full p-3 shadow-lg cursor-pointer transition-all duration-200 hover:scale-105">
          <Button
            onClick={() => setIsCollapsed(false)}
            variant="ghost"
            size="sm"
            className="p-0 h-auto text-white hover:text-white hover:bg-transparent"
          >
            <MessageCircle className="w-6 h-6" />
            {messages.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {messages.length}
              </span>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-4xl mx-4">
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Header with collapse button */}
          <div className="flex items-center justify-between p-3 text-black">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm">AI Agent</span>
            </div>
            <div className="flex items-center space-x-1">
              <Button
                onClick={() => setIsCollapsed(true)}
                variant="ghost"
                size="sm"
                className="p-1 h-auto text-white hover:text-white bg-gray-400 hover:bg-gray-800"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Input Bar */}
          <div className="p-4">
            <div className="flex items-center space-x-3">
              {/* Message Input */}
              <div className="flex-1 flex items-end space-x-2">
                <div className="flex-1 relative">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask the AI agent anything about your project..."
                    className="min-h-[40px] max-h-32 resize-none pr-12"
                    rows={1}
                  />
                  <div className="absolute right-2 bottom-2 text-xs text-gray-400">
                    {input.length > 0 && `${input.length} chars`}
                  </div>
                </div>

                <Button
                  onClick={handleSendMessage}
                  disabled={!input.trim()}
                  size="sm"
                  className="h-10"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
